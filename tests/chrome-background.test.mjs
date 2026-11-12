import { test } from 'node:test';
import assert from 'node:assert/strict';
const event = () => ({
  listeners: [],
  addListener(fn) {
    this.listeners.push(fn);
  },
});
test('快捷键先打开侧栏，再创建或复用笔记，创建结果反馈到当前窗口', async () => {
  const order = [],
    state = { bridgeConnection: { port: 43127, token: 'a'.repeat(64), protocol: 2 } },
    tab = { id: 7, windowId: 2, title: '当前课程', url: 'https://example.com/lesson' },
    requests = [];
  globalThis.chrome = {
    runtime: {
      id: 'a'.repeat(32),
      getURL: (p) => 'extension://' + p,
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
    },
    commands: { onCommand: event() },
    action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    alarms: { onAlarm: event(), create: async () => {} },
    tabs: { query: async () => [tab] },
    sidePanel: {
      setOptions: async () => {},
      open: (args) => {
        order.push('open');
        assert.ok(Number.isInteger(args.tabId));
        return Promise.resolve();
      },
    },
    storage: {
      session: {
        get: async (key) => ({ [key]: state[key] }),
        set: async (values) => Object.assign(state, values),
        remove: async (key) => {
          delete state[key];
        },
      },
      local: {
        get: async (key) =>
          typeof key === 'string' ? { [key]: state[key] } : Object.fromEntries(key.map((k) => [k, state[k]])),
        set: async (values) => {
          order.push('storage');
          Object.assign(state, values);
        },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    if (url === 'extension://connection.json')
      return { json: async () => ({ pairingCode: '43127:' + 'a'.repeat(64) }) };
    order.push('network');
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ ok: true, id: 'note-id', title: tab.title, url: tab.url, reused: false }),
    };
  };
  await import('../chrome-extension/background.js?panel-test');
  chrome.commands.onCommand.listeners[0]('capture-note', tab);
  for (let i = 0; i < 100 && state['reading-tab:7']?.status !== 'ready'; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(order[0], 'open');
  assert.equal(state['reading-tab:7'].id, 'note-id');
  assert.equal(state['reading-tab:7'].status, 'ready');
  assert.equal(requests[0].reuse, true);
  assert.equal(state.queue.length, 0);
  const newTab = { ...tab, id: 8 };
  chrome.commands.onCommand.listeners[0]('capture-note', newTab);
  for (let i = 0; i < 100 && (state['reading-tab:8']?.status !== 'ready' || state.queue.length); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(state['reading-tab:8'].id, 'note-id');
  assert.equal(state['reading-tab:7'].tabId, 7);
  assert.equal(state['reading-tab:8'].tabId, 8);
  assert.equal(requests[1].reuse, true);
  assert.equal(requests[1].reuseId, undefined, 'New tabs ask the server to find the URL');
  chrome.commands.onCommand.listeners[0]('capture-note', tab);
  for (
    let i = 0;
    i < 100 && (requests.length < 3 || state['reading-tab:7'].status !== 'ready' || state.queue.length);
    i++
  )
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(requests[2].reuseId, 'note-id', 'Existing tab bindings take priority');
});
test('截图只允许当前绑定网页；区域取消不会截屏', async () => {
  const ev = event(),
    tab = { id: 9, windowId: 4, url: 'https://example.com/video' };
  let screenshots = 0;
  globalThis.chrome = {
    runtime: { id: 'b'.repeat(32), onInstalled: event(), onStartup: event(), onMessage: ev },
    commands: { onCommand: event() },
    action: { onClicked: event() },
    alarms: { onAlarm: event() },
    tabs: {
      query: async () => [tab],
      captureVisibleTab: async () => {
        screenshots++;
      },
    },
    scripting: { executeScript: async () => [{ result: null }] },
  };
  await import('../chrome-extension/background.js?screen-test');
  const send = (m) => new Promise((resolve) => ev.listeners[0](m, { id: chrome.runtime.id }, resolve));
  let r = await send({ action: 'capture-screen', mode: 'region', windowId: 4, tabId: 8, url: tab.url });
  assert.equal(r.ok, false);
  assert.match(r.error, /网页已切换/);
  r = await send({ action: 'capture-screen', mode: 'region', windowId: 4, tabId: 9, url: tab.url });
  assert.equal(r.cancelled, true);
  assert.equal(screenshots, 0);
});
test('区域截图把 CSS 坐标换算为截图像素，并返回保存预览', async () => {
  const ev = event(),
    draws = [];
  const tab = { id: 9, windowId: 4, url: 'https://example.com/video' };
  globalThis.chrome = {
    runtime: { id: 'c'.repeat(32), onInstalled: event(), onStartup: event(), onMessage: ev },
    commands: { onCommand: event() },
    action: { onClicked: event() },
    alarms: { onAlarm: event() },
    tabs: { query: async () => [tab], captureVisibleTab: async () => 'data:image/png;base64,AAAA' },
    scripting: {
      executeScript: async () => [
        {
          result: {
            left: 100,
            top: 50,
            width: 200,
            height: 100,
            viewportWidth: 1000,
            viewportHeight: 500,
            videoTime: 123,
          },
        },
      ],
    },
  };
  globalThis.fetch = async () => ({ blob: async () => new Blob(['fixture']) });
  globalThis.createImageBitmap = async () => ({ width: 2000, height: 1000, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return { drawImage: (...args) => draws.push(args) };
    }
    async convertToBlob(o) {
      return new Blob(['fixture'], { type: o.type });
    }
  };
  await import('../chrome-extension/background.js?crop-test');
  const r = await new Promise((resolve) =>
    ev.listeners[0](
      { action: 'capture-screen', mode: 'region', windowId: 4, tabId: 9, url: tab.url },
      { id: chrome.runtime.id },
      resolve,
    ),
  );
  assert.equal(r.ok, true);
  assert.equal(r.width, 400);
  assert.equal(r.height, 200);
  assert.equal(r.videoTime, 123);
  assert.deepEqual(draws[0].slice(1), [200, 100, 400, 200, 0, 0, 400, 200]);
  assert.ok(r.dataURL.startsWith('data:image/png;'));
  assert.ok(r.preview.startsWith('data:image/jpeg;'));
});
test('选择区域后切换页面，不能把另一网页截入原笔记', async () => {
  const ev = event();
  let queries = 0,
    captures = 0;
  globalThis.chrome = {
    runtime: { id: 'd'.repeat(32), onInstalled: event(), onStartup: event(), onMessage: ev },
    commands: { onCommand: event() },
    action: { onClicked: event() },
    alarms: { onAlarm: event() },
    tabs: {
      query: async () => [{ id: ++queries === 1 ? 9 : 10, windowId: 4, url: 'https://example.com/video' }],
      captureVisibleTab: async () => {
        captures++;
      },
    },
    scripting: {
      executeScript: async () => [
        { result: { left: 10, top: 10, width: 50, height: 50, viewportWidth: 1000, viewportHeight: 500 } },
      ],
    },
  };
  await import('../chrome-extension/background.js?changed-tab');
  const r = await new Promise((resolve) =>
    ev.listeners[0](
      { action: 'capture-screen', mode: 'region', windowId: 4, tabId: 9, url: 'https://example.com/video' },
      { id: chrome.runtime.id },
      resolve,
    ),
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /页面已切换/);
  assert.equal(captures, 0);
});
