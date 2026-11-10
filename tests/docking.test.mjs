import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBottom, validateBottom, bottomMessage } from '../chrome-extension/docking.js';
test('底部面板只接受当前绑定网页中的扩展 iframe，等待就绪后才关闭侧栏', async () => {
  const storage = {},
    events = [],
    context = { id: 'note', url: 'https://example.com/lesson', tabId: 7, windowId: 2 },
    extension = 'chrome-extension://' + 'a'.repeat(32);
  globalThis.chrome = {
    runtime: { getURL: (path) => extension + '/' + path },
    tabs: { query: async () => [{ id: 7, url: context.url }] },
    sidePanel: { close: async () => events.push('closed') },
    storage: {
      session: {
        get: async (k) => ({ [k]: storage[k] }),
        set: async (v) => Object.assign(storage, v),
        remove: async (k) => delete storage[k],
      },
      local: { get: async () => ({}), set: async () => {} },
    },
    scripting: {
      executeScript: async (options) => {
        events.push('mounted');
        const session = new URL(options.args[0].src).searchParams.get('session');
        assert.equal(events.includes('closed'), false);
        const sender = {
          tab: { id: 7, url: context.url },
          frameId: 4,
          url: extension + '/sidepanel.html?surface=bottom&session=' + session,
        };
        assert.ok(await validateBottom({ session }, sender));
        assert.equal(await validateBottom({ session: 'wrong' }, sender), null);
        assert.equal(
          await validateBottom({ session }, { ...sender, tab: { id: 7, url: 'https://wrong.test' } }),
          null,
        );
        assert.equal(await validateBottom({ session }, { ...sender, frameId: 0 }), null);
        await bottomMessage({ action: 'bottom-ready', session }, sender);
      },
    },
  };
  assert.equal((await openBottom(context)).ok, true);
  assert.deepEqual(events, ['mounted', 'closed']);
});
