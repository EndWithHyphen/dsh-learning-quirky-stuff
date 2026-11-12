import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTabNote,
  updateTabNote,
  tabContext,
  panelContext,
  configureTab,
  removePurgedTabNotes,
} from '../chrome-extension/tab-notes.js';
test('标签页绑定独立，旧窗口绑定仅迁移到原标签页；新标签页等待按 URL 查找', async () => {
  const local = { 'reading:1': { id: 'legacy-note', tabId: 7, windowId: 1, url: 'https://example.com/a' } },
    session = {},
    configured = [];
  const area = (data) => ({
    get: async (k) => (k === null ? { ...data } : { [k]: data[k] }),
    set: async (v) => Object.assign(data, v),
    remove: async (k) => {
      delete data[k];
    },
  });
  globalThis.chrome = {
    storage: { local: area(local), session: area(session) },
    tabs: { get: async (id) => ({ id, windowId: 1, url: 'https://example.com/a' }) },
    sidePanel: { setOptions: async (options) => configured.push(options) },
  };
  assert.equal((await tabContext({ id: 7, windowId: 1, url: 'https://example.com/a' })).id, 'legacy-note');
  assert.equal(await tabContext({ id: 8, windowId: 1, url: 'https://example.com/a' }), null);
  await updateTabNote(8, () => ({ id: 'other-note', tabId: 8, windowId: 1, url: 'https://example.com/a' }));
  assert.equal((await readTabNote(7)).id, 'legacy-note');
  assert.equal((await panelContext({ tabId: 8, windowId: 1 })).context.id, 'other-note');
  await configureTab(7);
  await configureTab(8);
  assert.notEqual(configured[0].path, configured[1].path);
  await removePurgedTabNotes(['legacy-note']);
  assert.equal(await readTabNote(7), null);
  assert.equal((await readTabNote(8)).id, 'other-note');
});

test('侧栏默认关闭，只启用用户打开的标签页，异步初始化不覆盖已打开状态', async () => {
  const { configureExistingTabs, openTabPanel, forgetTabPanel } = await import(
    '../chrome-extension/tab-notes.js'
  );
  const options = new Map(),
    calls = [];
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 41 }, { id: 42 }] },
    sidePanel: {
      setOptions: async (value) => {
        calls.push(['configure', value.tabId, value.enabled]);
        options.set(value.tabId ?? 'default', value);
      },
      open: ({ tabId }) => {
        calls.push(['open', tabId]);
        assert.equal(options.get(tabId).enabled, true);
        return Promise.resolve();
      },
    },
  };
  const setup = configureExistingTabs(),
    open = openTabPanel(41);
  await Promise.all([setup, open]);
  assert.equal(options.get('default').enabled, false);
  assert.equal(options.get(41).enabled, true);
  assert.equal(options.get(42).enabled, false);
  assert.equal(options.get(41).path, 'sidepanel.html?tabId=41');
  assert.ok(
    calls.findIndex((c) => c[0] === 'configure' && c[1] === 41) < calls.findIndex((c) => c[0] === 'open'),
  );
  await configureTab(43);
  assert.equal(options.get(43).enabled, false, 'New tabs must not inherit another tab’s open side panel');
  forgetTabPanel(41);
  await configureTab(41);
  assert.equal(options.get(41).enabled, false);
});
