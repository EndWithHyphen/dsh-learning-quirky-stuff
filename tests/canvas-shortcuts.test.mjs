import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindCanvasShortcuts } from '../src/canvas-shortcuts.js';
test('画布快捷键保留浏览器组合键，文字输入不触发操作，外部控件不受影响', () => {
  const dom = new JSDOM(
    '<div id="root"><button id="tools">工具</button><div class="excalidraw" tabindex="0"><canvas tabindex="0"></canvas><textarea></textarea></div></div><input id="outside">',
  );
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true });
  const root = dom.window.document.querySelector('#root'),
    engine = root.querySelector('.excalidraw'),
    canvas = engine.querySelector('canvas'),
    received = [],
    calls = [];
  engine.addEventListener('keydown', (e) => received.push(e.code));
  const state = {
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
    width: 800,
    height: 600,
    selectedElementIds: {},
  };
  const api = {
    getAppState: () => state,
    updateScene: (r) => Object.assign(state, r.appState),
    getSceneElements: () => [],
    setToast: () => {},
  };
  const unbind = bindCanvasShortcuts(root, {
    getApi: () => api,
    onSave: () => calls.push('save'),
    onCapture: (mode) => calls.push(mode),
    onHelp: () => calls.push('help'),
  });
  const press = (target, code, options = {}) => {
    const e = new dom.window.KeyboardEvent('keydown', {
      key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
      code,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(e);
    return e;
  };
  for (const code of ['KeyL', 'KeyT', 'KeyR', 'KeyP', 'KeyS', 'KeyF', 'KeyG', 'Digit1', 'Equal']) {
    const e = press(canvas, code, { metaKey: true });
    assert.equal(e.defaultPrevented, false);
    assert.equal(received.includes(code), false);
  }
  assert.equal(press(canvas, 'KeyS', { altKey: true }).defaultPrevented, true);
  assert.deepEqual(calls, ['save']);
  press(canvas, 'KeyS', { altKey: true, shiftKey: true });
  press(canvas, 'KeyV', { altKey: true, shiftKey: true });
  assert.deepEqual(calls, ['save', 'region', 'full']);
  const typing = press(engine.querySelector('textarea'), 'KeyS', { altKey: true });
  assert.equal(typing.defaultPrevented, false);
  assert.equal(calls.length, 3);
  press(dom.window.document.querySelector('#outside'), 'KeyS', { altKey: true });
  assert.equal(calls.length, 3);
  received.length = 0;
  press(canvas, 'KeyK');
  assert.equal(received.length, 0);
  press(canvas, 'KeyZ', { metaKey: true });
  assert.deepEqual(received, ['KeyZ']);
  press(root.querySelector('#tools'), 'KeyR');
  assert.equal(received.at(-1), 'KeyR');
  assert.equal(dom.window.document.activeElement, engine);
  press(canvas, 'Equal');
  assert.equal(state.zoom.value, 1.25);
  assert.equal(400 / state.zoom.value - state.scrollX, 400);
  press(canvas, 'Digit0', { shiftKey: true });
  assert.equal(state.zoom.value, 1);
  unbind();
  dom.window.close();
});
