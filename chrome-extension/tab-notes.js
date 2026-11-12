const tails = new Map();
const openedPanelTabs = new Set();
export const tabNoteKey = (id) => 'reading-tab:' + id;
export async function readTabNote(id) {
  return (await chrome.storage.session.get(tabNoteKey(id)))[tabNoteKey(id)] || null;
}
export function updateTabNote(id, change) {
  const previous = tails.get(id) || Promise.resolve(),
    task = previous
      .catch(() => {})
      .then(async () => {
        const current = await readTabNote(id),
          next = await change(current);
        if (next) {
          const values = { [tabNoteKey(id)]: next },
            dockKey = 'dock:' + id,
            dock = (await chrome.storage.session.get(dockKey))[dockKey];
          if (dock && next.id) values[dockKey] = { ...dock, context: next };
          await chrome.storage.session.set(values);
        } else await chrome.storage.session.remove(tabNoteKey(id));
        return next;
      });
  tails.set(id, task);
  task
    .finally(() => {
      if (tails.get(id) === task) tails.delete(id);
    })
    .catch(() => {});
  return task;
}
export function configureTab(id, enabled = false) {
  if (enabled) openedPanelTabs.add(id);
  return chrome.sidePanel.setOptions({
    tabId: id,
    path: 'sidepanel.html?tabId=' + id,
    enabled: openedPanelTabs.has(id),
  });
}
export function openTabPanel(id) {
  // Dispatch these Chrome API calls together, before any storage/network await,
  // so open() still runs in the action/keyboard user gesture.
  const configured = configureTab(id, true);
  const opened = chrome.sidePanel.open({ tabId: id });
  return Promise.all([configured, opened]).then(() => undefined);
}
export function forgetTabPanel(id) {
  openedPanelTabs.delete(id);
}
export async function configureExistingTabs() {
  await chrome.sidePanel.setOptions({ enabled: false });
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => configureTab(tab.id)));
}
export async function tabContext(tab) {
  const current = await readTabNote(tab.id);
  if (current) return current;
  const key = 'reading:' + tab.windowId,
    legacy = (await chrome.storage.local.get(key))[key];
  if (legacy?.tabId === tab.id && legacy.url === tab.url) {
    await updateTabNote(tab.id, (existing) => existing || legacy);
    await chrome.storage.local.remove(key);
    return legacy;
  }
  return null;
}
export async function panelContext({ tabId, windowId }) {
  let tab;
  if (Number.isInteger(tabId)) tab = await chrome.tabs.get(tabId).catch(() => null);
  else [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab) return { ok: true, context: null, tabId: null };
  return { ok: true, context: await tabContext(tab), tabId: tab.id };
}
export async function removePurgedTabNotes(ids) {
  const removed = new Set(ids),
    values = await chrome.storage.session.get(null);
  for (const key of Object.keys(values))
    if (key.startsWith('reading-tab:'))
      await updateTabNote(Number(key.slice(12)), (current) => (removed.has(current?.id) ? null : current));
}
