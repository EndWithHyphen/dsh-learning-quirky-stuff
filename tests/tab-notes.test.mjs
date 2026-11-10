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
test('标签页笔记独立，旧窗口绑定仅迁移到原标签页，同 URL 的另一个标签页不复用', async () => {
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
