import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forgetPurgedSelections,
  recordSelection,
  registerSelectionMenu,
  retrySelections,
  selectionMenuClick,
  selectionShortcut,
} from '../chrome-extension/selection-capture.js';

function area(values = {}) {
  return {
    values,
    get: async (key) => ({ [key]: values[key] }),
    set: async (changes) => Object.assign(values, changes),
    remove: async (key) => {
      delete values[key];
    },
  };
}
function extension(t) {
  const local = area({ bridgeConnection: { port: 43127, protocol: 2, token: 'a'.repeat(64) } }),
    session = area();
  const tab = { id: 5, windowId: 1, title: '读书札记', url: 'https://example.test/read' };
  const state = { tab, local, session, calls: [], scripts: [], titles: [], menus: new Map() };
  const runtime = { sendMessage: async (m) => state.panel?.(m) };
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime,
    storage: { local, session },
    tabs: { get: async () => state.tab, query: async () => [state.tab] },
    action: { setBadgeText: async () => {}, setTitle: async ({ title }) => state.titles.push(title) },
    scripting: {
      executeScript: async (script) => {
        state.scripts.push(script);
        if (script.args[0] === 'read' && state.noFrameAccess) throw new Error('Cannot access frame');
        return [{ result: state.selection }];
      },
    },
    contextMenus: {
      update(id, options, done) {
        if (state.menus.has(id)) state.menus.set(id, options);
        else runtime.lastError = { message: 'missing' };
        done();
        delete runtime.lastError;
      },
      create({ id, ...options }, done) {
        state.menus.set(id, options);
        delete runtime.lastError;
        done();
      },
    },
  };
  t.after(() => {
    globalThis.chrome = previous;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const item = JSON.parse(options.body);
    assert.equal(new URL(url).pathname, item.kind === 'excerpt' ? '/capture/excerpt' : '/capture/quote');
    state.calls.push(item);
    if (state.offline) throw new Error('disconnected');
    return Response.json({
      ok: true,
      id: item.reuseId || 'new-note',
      ...(item.kind === 'excerpt' ? { elementId: item.requestId } : { quoteId: item.requestId }),
      url: item.url,
      title: item.title,
    });
  });
  return state;
}

test('右键菜单保留当前选区的空白、所在框架的链接和标签页绑定', async (t) => {
  const s = extension(t);
  registerSelectionMenu();
  registerSelectionMenu();
  assert.equal(s.menus.size, 2);
  const [menuItemId, options] = [...s.menus][0];
  assert.deepEqual(options.contexts, ['selection']);
  assert.deepEqual(options.documentUrlPatterns, ['http://*/*', 'https://*/*']);
  s.session.values['reading-tab:5'] = { id: 'chosen-note', url: s.tab.url };
  const frameUrl = 'https://reader.example.test/passage';
  const info = { menuItemId, pageUrl: s.tab.url, frameUrl, frameId: 14, selectionText: '第一段。 第二段。' };
  s.selection = { url: frameUrl, text: '  第一段。\n\n\t第二段。 ' };
  await selectionMenuClick(info, s.tab);
  assert.deepEqual(s.scripts[0].target, { tabId: 5, frameIds: [14] });
  assert.equal(s.calls[0].text, s.selection.text);
  assert.equal(s.calls[0].sourceUrl, frameUrl);
  assert.equal(s.calls[0].url, s.tab.url);
  assert.equal(s.calls[0].reuseId, 'chosen-note');
  assert.equal(s.calls[0].kind, 'excerpt');
  assert.ok(s.titles.at(-1).includes('已摘录到画布'));
  s.noFrameAccess = true;
  await selectionMenuClick(
    { ...info, menuItemId: 'studyboard-quote-selection', selectionText: '另一框架所选的原句。' },
    s.tab,
  );
  assert.equal(s.calls[1].text, '另一框架所选的原句。');
  assert.equal(s.calls[1].kind, 'quote');
  await selectionMenuClick({ ...info, editable: true }, s.tab);
  s.noFrameAccess = false;
  s.selection = { editable: true, text: '', url: frameUrl };
  await selectionMenuClick(info, s.tab);
  await selectionMenuClick({ ...info, menuItemId: 'unrelated' }, s.tab);
  await selectionMenuClick({ ...info, pageUrl: 'https://example.test/before' }, s.tab);
  await assert.rejects(recordSelection(s.tab, '字'.repeat(6001)), /6000/);
  await assert.rejects(recordSelection(s.tab, ' \n\t'), /选中/);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.local.values.pendingSelectionQuotes, []);
});

test('离线选区重试沿用原编号，切页后不会写入新笔记或更改新标签的绑定', async (t) => {
  const s = extension(t),
    original = s.tab;
  s.session.values['reading-tab:5'] = { id: 'source-note', url: original.url };
  s.offline = true;
  const queued = await Promise.all([
    recordSelection(original, '摘录 A'),
    recordSelection(original, '金句 B', original.url, 'quote'),
  ]);
  assert.ok(queued.every((item) => item.ok && item.queued));
  const items = structuredClone(s.local.values.pendingSelectionQuotes);
  assert.equal(items.length, 2);
  assert.deepEqual(new Set(items.map((item) => item.kind)), new Set(['excerpt', 'quote']));
  assert.notEqual(items[0].requestId, items[1].requestId);
  await Promise.all([retrySelections(), retrySelections()]);
  assert.equal(s.calls.length, 3, 'disconnected retries wait for the next alarm');
  s.tab = { ...original, url: 'https://example.test/new' };
  s.session.values['reading-tab:5'] = { id: 'newer-note', url: s.tab.url };
  s.offline = false;
  await retrySelections();
  assert.deepEqual(s.calls.slice(-2), items);
  assert.deepEqual(s.local.values.pendingSelectionQuotes, []);
  assert.equal(s.session.values['reading-tab:5'].id, 'newer-note');
  assert.equal(s.titles.filter((v) => v.includes('已摘录到画布')).length, 0);
});

test('打开的画布先处理摘录，有未同步笔迹时会保留摘录等待重试', async (t) => {
  const s = extension(t);
  s.session.values['reading-tab:5'] = { id: 'open-note', url: s.tab.url };
  let delivered;
  s.panel = ({ action, item }) => {
    assert.equal(action, 'sync-excerpt-in-panel');
    delivered = item;
    return { handled: true, ok: false, error: '请先处理当前画布的冲突', code: 'CANVAS_CONFLICT' };
  };
  assert.equal((await recordSelection(s.tab, '原话')).queued, true);
  assert.equal(s.local.values.pendingSelectionQuotes[0].requestId, delivered.requestId);
  s.panel = ({ item }) => ({
    handled: true,
    ok: true,
    value: { id: item.reuseId, url: item.url, title: item.title, elementId: 'clip' },
  });
  await retrySelections();
  assert.equal(s.calls.length, 0);
  assert.deepEqual(s.local.values.pendingSelectionQuotes, []);
  s.panel = null;
  s.offline = true;
  await recordSelection(s.tab, '将随笔记删除');
  await forgetPurgedSelections(new Set(['open-note']), new Set());
  assert.deepEqual(s.local.values.pendingSelectionQuotes, []);
});

test('两条划词快捷键直接保存各自类型，只读取当前页的正文选区', async (t) => {
  const s = extension(t);
  s.selection = { url: s.tab.url, sourceUrl: 'https://example.test/inner', text: '  原句。\n' };
  await selectionShortcut('studyboard-clip-selection', s.tab);
  await selectionShortcut('studyboard-quote-selection');
  assert.deepEqual(
    s.calls.map((item) => [item.kind, item.text, item.sourceUrl]),
    [
      ['excerpt', s.selection.text, s.selection.sourceUrl],
      ['quote', s.selection.text, s.selection.sourceUrl],
    ],
  );
  assert(s.scripts.some((script) => script.args[0] === 'read-focused'));
  for (const selection of [
    { editable: true },
    { unavailable: true },
    { text: '   ' },
    { url: 'https://example.test/old', text: '旧地址' },
  ]) {
    s.selection = { url: s.tab.url, ...selection };
    await selectionShortcut('studyboard-clip-selection', s.tab);
  }
  await selectionShortcut('unknown', s.tab);
  assert.equal(s.calls.length, 2);
});

test('升级后离线队列中原来的金句仍通过原接口同步', async (t) => {
  const s = extension(t);
  s.local.values.pendingSelectionQuotes = [
    {
      text: '旧版保存的金句',
      url: s.tab.url,
      tabId: s.tab.id,
      windowId: s.tab.windowId,
      requestId: 'legacy-quote',
      title: s.tab.title,
    },
  ];
  await retrySelections();
  assert.equal(s.calls.length, 1);
  assert(s.titles[0].includes('已记为金句'));
  assert.deepEqual(s.local.values.pendingSelectionQuotes, []);
});
