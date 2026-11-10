import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
test('侧栏打开当前网页笔记，输入即时保留草稿并同步，保存反馈可见', async () => {
  const dom = new JSDOM(
    await readFile(new URL('../chrome-extension/sidepanel.html', import.meta.url), 'utf8'),
    { url: 'https://extension.test/' },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const handlers = [],
    state = {
      bridgeConnection: { port: 43127, token: 'a'.repeat(64), protocol: 2 },
      'reading:2': {
        id: 'note-1',
        title: '课程',
        url: 'https://example.com/lesson',
        tabId: 7,
        windowId: 2,
        status: 'ready',
      },
    };
  const saved = [];
  globalThis.chrome = {
    runtime: {
      getURL: (p) => 'extension://' + p,
      getManifest: () => ({ version: '2.1.0' }),
      sendMessage: async (m) =>
        m.action === 'panel-context' ? { ok: true, tabId: 7, context: state['reading:2'] } : { ok: true },
    },
    windows: { getCurrent: async () => ({ id: 2 }) },
    storage: {
      onChanged: { addListener: (f) => handlers.push(f) },
      local: {
        get: async (key) => (key === null ? { ...state } : { [key]: state[key] }),
        set: async (values) => Object.assign(state, values),
        remove: async (key) => {
          delete state[key];
        },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    if (url === 'extension://connection.json')
      return { json: async () => ({ pairingCode: '43127:' + 'a'.repeat(64) }) };
    const body = JSON.parse(options.body);
    if (url.endsWith('/client-event')) return { ok: true, json: async () => ({ received: true }) };
    if (url.endsWith('/note/get'))
      return {
        ok: true,
        json: async () => ({ title: '课程', webNotes: { text: '已有笔记', version: 1 }, images: [] }),
      };
    if (url.endsWith('/note/save')) {
      saved.push(body);
      return {
        ok: true,
        json: async () => ({ webNotes: { text: body.text, version: body.baseVersion + 1 } }),
      };
    }
    throw new Error('unexpected route');
  };
  const interval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  try {
    await import('../chrome-extension/sidepanel.js?unit');
  } finally {
    globalThis.setInterval = interval;
  }
  const editor = document.querySelector('#notes');
  assert.equal(editor.value, '已有笔记');
  assert.equal(document.querySelector('#workspace').hidden, false);
  assert.match(document.querySelector('#status').textContent, /笔记已创建/);
  editor.value = '看视频时的新理解';
  editor.dispatchEvent(new dom.window.Event('input'));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    Object.values(state).some((v) => v?.text === '看视频时的新理解'),
    true,
  );
  document.querySelector('#save').click();
  for (let i = 0; i < 100 && !document.querySelector('#status').textContent.includes('已保存到 DSH'); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(saved[0].text, '看视频时的新理解');
  assert.equal(saved[0].id, 'note-1');
  assert.match(document.querySelector('#status').textContent, /已保存到 DSH/);
  assert.equal(document.querySelector('#capture-region').disabled, false);
  await new Promise((r) => setTimeout(r, 700));
});
test('侧栏 Esc/按钮可取消区域截图，删除截图先保存手写画布，并可撤销', async () => {
  const dom = new JSDOM(
    await readFile(new URL('../chrome-extension/sidepanel.html', import.meta.url), 'utf8'),
    { url: 'https://extension.test/' },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const state = {
      bridgeConnection: { port: 43127, token: 'b'.repeat(64), protocol: 2 },
      'reading:3': {
        id: 'note-delete',
        title: '视频',
        url: 'https://example.com/video',
        tabId: 9,
        windowId: 3,
        status: 'ready',
      },
    },
    order = [];
  let deleted = false,
    screenResolve,
    cancelCount = 0;
  const image = {
    id: 'image-one',
    caption: '区域截图',
    createdAt: new Date().toISOString(),
    preview: 'data:image/png;base64,AAAA',
  };
  window.StudyboardCanvas = {
    mount: async () => ({
      id: 'note-delete',
      dirty: false,
      flush: async () => order.push('flush'),
      reload: async () => order.push('reload'),
      setBusy: () => {},
      refresh: () => {},
      dispose: async () => {},
      focus: () => {},
    }),
  };
  globalThis.chrome = {
    runtime: {
      getURL: (p) => 'extension://' + p,
      getManifest: () => ({ version: '2.2.0' }),
      sendMessage: async (m) => {
        if (m.action === 'panel-context') return { ok: true, tabId: 9, context: state['reading:3'] };
        if (m.action === 'capture-screen') return new Promise((r) => (screenResolve = r));
        if (m.action === 'cancel-capture') {
          cancelCount++;
          screenResolve({ ok: true, cancelled: true });
          return { ok: true };
        }
        return { ok: true };
      },
    },
    windows: { getCurrent: async () => ({ id: 3 }) },
    storage: {
      onChanged: { addListener: () => {} },
      local: {
        get: async (k) => (k === null ? { ...state } : { [k]: state[k] }),
        set: async (v) => Object.assign(state, v),
        remove: async (k) => delete state[k],
      },
    },
  };
  const lists = () => ({
    images: deleted ? [] : [image],
    deletedImages: deleted ? [{ ...image, deletedAt: new Date().toISOString() }] : [],
  });
  globalThis.fetch = async (url, options) => {
    let result;
    if (url === 'extension://connection.json') result = { pairingCode: '43127:' + 'b'.repeat(64) };
    else if (url.endsWith('/client-event')) result = {};
    else if (url.endsWith('/note/get'))
      result = { title: '视频', webNotes: { text: '', version: 0 }, ...lists() };
    else if (url.endsWith('/note/image/delete')) {
      order.push('delete');
      deleted = true;
      result = lists();
    } else if (url.endsWith('/note/image/restore')) {
      order.push('restore');
      deleted = false;
      result = lists();
    } else throw new Error('unexpected route ' + url);
    return { ok: true, json: async () => result };
  };
  const interval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  try {
    await import('../chrome-extension/sidepanel.js?delete-cancel');
  } finally {
    globalThis.setInterval = interval;
  }
  const until = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(fn());
  };
  await until(() => document.querySelector('#canvas-loading').hidden);
  document.querySelector('#capture-region').click();
  assert.equal(document.querySelector('#cancel-capture').hidden, false);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => !document.querySelector('#capture-region').disabled);
  assert.equal(cancelCount, 1);
  assert.match(document.querySelector('#status').textContent, /已取消/);
  document.querySelector('#capture-region').click();
  document.querySelector('#cancel-capture').click();
  await until(() => !document.querySelector('#capture-region').disabled);
  assert.equal(cancelCount, 2);
  order.length = 0;
  document.querySelector('.delete-image').click();
  await until(
    () =>
      document.querySelector('#gallery').children.length === 0 &&
      !document.querySelector('#undo-image').disabled,
  );
  assert.deepEqual(order, ['flush', 'delete', 'reload']);
  assert.equal(document.querySelector('#image-undo').hidden, false);
  assert.equal(document.querySelector('#deleted-gallery').children.length, 1);
  document.querySelector('#undo-image').click();
  await until(
    () =>
      document.querySelector('#gallery').children.length === 1 &&
      !document.querySelector('#capture-region').disabled,
  );
  assert.equal(deleted, false);
  assert.equal(document.querySelector('#deleted-section').hidden, true);
  dom.window.close();
});
