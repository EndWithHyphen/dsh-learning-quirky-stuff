import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPreviewPanel } from '../chrome-extension/preview-panel.js';

test('切换绑定会丢弃旧网页的读取结果，空正文提示手动导入且不启动模型', async (t) => {
  const dom = new JSDOM('<button id="study"></button><main></main>');
  const oldDocument = globalThis.document,
    oldChrome = globalThis.chrome;
  globalThis.document = dom.window.document;
  let completeRead;
  globalThis.chrome = {
    runtime: {
      sendMessage: () =>
        new Promise((resolve) => {
          completeRead = resolve;
        }),
    },
    storage: {
      local: {
        get: async (key) =>
          key === 'bridgeConnection'
            ? { bridgeConnection: { port: 43127, protocol: 2, token: 'a'.repeat(64) } }
            : {},
      },
    },
  };
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('unexpected request');
  });
  const button = document.querySelector('#study'),
    root = document.querySelector('main');
  const panel = createPreviewPanel(root, button);
  t.after(() => {
    panel.dispose();
    dom.window.close();
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
  });
  const first = { id: 'a', tabId: 10, url: 'https://example.test/a' };
  const second = { id: 'b', tabId: 11, url: 'https://example.test/b' };
  await panel.setContext(first);
  const reading = panel.summarizePage();
  assert.equal(button.disabled, true);
  await panel.setContext(second);
  completeRead({ ok: true, document: { url: first.url, blocks: [{ text: '旧标签页正文' }] } });
  await reading;
  assert.equal(button.disabled, false);
  assert(!root.textContent.includes('旧标签页正文'));
  const empty = panel.summarizePage();
  completeRead({ ok: true, document: { url: second.url, blocks: [], needsTranscript: true } });
  await empty;
  assert(root.querySelector('details').open);
  assert.match(root.querySelector('.preview-status').textContent, /粘贴字幕/);
  assert.equal(network.mock.callCount(), 0);
});
