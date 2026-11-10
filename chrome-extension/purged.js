import { request } from './bridge.js';
import { draftPurge } from './drafts.js';
import { removePurgedTabNotes } from './tab-notes.js';
import { removeBottomDrawer } from './bottom-drawer.js';
let running;
export function syncPurged({ updateQueue } = {}) {
  if (running) return running;
  running = (async () => {
    const result = await request('/note/purged'),
      ids = new Set(result.ids || []),
      requests = new Set(result.requestIds || []);
    if (!ids.size && !requests.size) return { ok: true };
    const previous = (await chrome.storage.local.get('purgedNotes')).purgedNotes || [];
    if ([...ids].some((id) => !previous.includes(id)))
      await chrome.storage.local.set({ purgedNotes: [...ids] });
    const docks = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(docks))
      if (key.startsWith('dock:') && ids.has(value.context?.id)) {
        await chrome.runtime
          .sendMessage({ action: 'purge-dock', session: value.session, ids: [...ids] })
          .catch(() => {});
        await chrome.scripting
          .executeScript({ target: { tabId: Number(key.slice(5)) }, func: removeBottomDrawer })
          .catch(() => {});
        await chrome.storage.session.remove(key);
      }
    const all = await chrome.storage.local.get(null),
      remove = [];
    for (const [key, value] of Object.entries(all))
      if (
        /^(reading:|draft:|pending-screenshot:)/.test(key) &&
        value &&
        (ids.has(value.id) || ids.has(value.noteId) || requests.has(value.requestId))
      )
        remove.push(key);
    if (remove.length) {
      const latest = await chrome.storage.local.get(remove);
      const stillRemoved = remove.filter((key) => {
        const value = latest[key];
        return value && (ids.has(value.id) || ids.has(value.noteId) || requests.has(value.requestId));
      });
      if (stillRemoved.length) await chrome.storage.local.remove(stillRemoved);
    }
    if (updateQueue) await updateQueue((queue) => queue.filter((item) => !requests.has(item.requestId)));
    else if (Array.isArray(all.queue)) {
      const queue = all.queue.filter((item) => !requests.has(item.requestId));
      if (queue.length !== all.queue.length) await chrome.storage.local.set({ queue });
    }
    await draftPurge([...ids]);
    await removePurgedTabNotes([...ids]);
    return { ok: true };
  })().finally(() => {
    running = null;
  });
  return running;
}
