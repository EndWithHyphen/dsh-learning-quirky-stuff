import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { selectRegion, cancelRegion } from '../chrome-extension/region-selection.js';
function setup() {
  const dom = new JSDOM('<!doctype html><button id="previous">原焦点</button>', { pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    CustomEvent: dom.window.CustomEvent,
  });
  document.querySelector('button').focus();
  return dom;
}
test('区域截图主动获得焦点；网页 Esc 立即移除遮罩，不依赖动画帧', async () => {
  const dom = setup();
  globalThis.requestAnimationFrame = () => assert.fail('取消不能等待动画帧');
  const result = selectRegion('esc');
  assert.equal(document.activeElement.id, '__studyboard_capture');
  const browserShortcut = new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(browserShortcut);
  assert.equal(browserShortcut.defaultPrevented, false);
  assert.ok(document.getElementById('__studyboard_capture'));
  document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert.equal(await result, null);
  assert.equal(document.getElementById('__studyboard_capture'), null);
  assert.equal(document.activeElement.id, 'previous');
  dom.window.close();
});
test('侧栏取消消息与网页取消按钮都清理选区；提前取消也不会再出现遮罩', async () => {
  const dom = setup();
  let result = selectRegion('sidebar');
  cancelRegion('sidebar');
  assert.equal(await result, null);
  result = selectRegion('button');
  document.querySelector('#__studyboard_capture button').click();
  assert.equal(await result, null);
  cancelRegion('early');
  assert.equal(await selectRegion('early'), null);
  assert.equal(document.querySelector('#__studyboard_capture'), null);
  dom.window.close();
});
