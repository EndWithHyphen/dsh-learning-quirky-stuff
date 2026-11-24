import { saveSelection } from './bridge.js';
import { tabContext, updateTabNote } from './tab-notes.js';
import { pageSelection, selectionNotice } from './selection-tool.js';

const actions = new Map([
  ['studyboard-clip-selection', { kind: 'excerpt', title: '普通摘录' }],
  ['studyboard-quote-selection', { kind: 'quote', title: '金句记录' }],
]);
const storageKey = 'pendingSelectionQuotes';
let storageTail = Promise.resolve();
let retrying;
const sending = new Map();

function updatePending(change) {
  const work = storageTail.then(async () => {
    const previous = (await chrome.storage.local.get(storageKey))[storageKey] || [];
    const next = change(previous);
    if (next !== previous) await chrome.storage.local.set({ [storageKey]: next });
  });
  storageTail = work.catch(() => {});
  return work;
}
function forget(id) {
  return updatePending((items) => items.filter((item) => item.requestId !== id));
}
export function forgetPurgedSelections(ids, requests) {
  return updatePending((items) => {
    const kept = items.filter((item) => !ids.has(item.reuseId) && !requests.has(item.requestId));
    return kept.length === items.length ? items : kept;
  });
}
async function feedback(tabId, badge, message) {
  if (!Number.isInteger(tabId)) return;
  await Promise.allSettled([
    chrome.action.setBadgeText?.({ tabId, text: badge }),
    chrome.action.setTitle?.({ tabId, title: message }),
  ]);
}
async function originalTab(item) {
  const tab = await chrome.tabs.get(item.tabId).catch(() => null);
  return tab?.url === item.url && tab.windowId === item.windowId ? tab : null;
}
async function deliver(item) {
  try {
    // An open canvas flushes its local edits before the server appends the card.
    const panel =
      item.reuseId &&
      (await chrome.runtime
        .sendMessage({
          action: item.kind === 'excerpt' ? 'sync-excerpt-in-panel' : 'sync-selection-in-panel',
          item,
        })
        .catch(() => null));
    if (panel?.handled && !panel.ok) throw Object.assign(new Error(panel.error), { code: panel.code });
    const saved = panel?.handled ? panel.value : await saveSelection(item);
    if (!(saved?.elementId || saved?.quoteId) || saved.url !== item.url)
      throw new Error('未收到摘录保存回执');
    await forget(item.requestId);
    // The clip belongs to its original page even if the tab navigated or closed during the save.
    const tab = await originalTab(item);
    const message = item.kind === 'excerpt' ? '已摘录到画布' : '已记为金句';
    if (tab) {
      await updateTabNote(tab.id, (current) =>
        current?.url === item.url
          ? current
          : {
              id: saved.id,
              title: saved.title,
              url: saved.url,
              tabId: tab.id,
              windowId: tab.windowId,
              requestId: item.requestId,
              status: 'ready',
              reused: saved.reused,
            },
      ).catch(() => {});
      await feedback(tab.id, '✓', message + ' · ' + saved.title);
    }
    return { ok: true, queued: false, message };
  } catch (error) {
    const tab = await originalTab(item);
    if (error.code === 'NOTE_PURGED') {
      await forget(item.requestId);
      await feedback(tab?.id, '!', '来源笔记已永久删除');
      return { ok: false, error: '来源笔记已永久删除' };
    }
    await feedback(tab?.id, '…', '摘录已暂存 · ' + error.message);
    return { ok: true, queued: true, message: error.message, code: error.code };
  }
}
function sync(item) {
  let work = sending.get(item.requestId);
  if (!work) {
    work = deliver(item).finally(() => sending.delete(item.requestId));
    sending.set(item.requestId, work);
  }
  return work;
}
export function retrySelections() {
  if (!retrying)
    retrying = (async () => {
      const items = (await chrome.storage.local.get(storageKey))[storageKey] || [];
      for (const item of items) {
        const result = await sync(item);
        if (['BRIDGE_OFFLINE', 'BRIDGE_NOT_PAIRED', 'BRIDGE_UPDATE_REQUIRED'].includes(result.code)) break;
      }
    })().finally(() => {
      retrying = null;
    });
  return retrying;
}
function webUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请在普通网页中摘录');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请在普通网页中摘录');
  if (url.href.length > 10000) throw new Error('网页链接过长，无法保存这条摘录');
  return url.href;
}
export async function recordSelection(tab, text, sourceUrl = tab?.url, kind = 'excerpt') {
  if (!Number.isInteger(tab?.id)) throw new Error('无法确定摘录的标签页');
  if (kind !== 'excerpt' && kind !== 'quote') throw new Error('未知的摘录方式');
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先选中网页上的文字');
  if (text.length > 6000) throw new Error('单条摘录最多 6000 个字符，请缩短选区');
  const url = webUrl(tab.url),
    link = webUrl(sourceUrl),
    prior = await tabContext(tab);
  const item = {
    requestId: crypto.randomUUID(),
    kind,
    text,
    url,
    sourceUrl: link,
    title: (tab.title || new URL(url).hostname).slice(0, 500),
    tabId: tab.id,
    windowId: tab.windowId,
    ...(prior?.url === url && prior.id ? { reuseId: prior.id } : {}),
  };
  await updatePending((items) => {
    if (items.length >= 100) throw new Error('已有 100 条摘录等待同步，请先连接 DSH');
    return [...items, item];
  });
  return sync(item);
}
export async function enableSelectionTool(tab) {
  if (!chrome.scripting) return;
  const commands = (await chrome.commands?.getAll?.().catch(() => [])) || [];
  const shortcuts = Object.fromEntries(
    commands
      .filter((c) => c.shortcut && actions.has(c.name))
      .map((c) => [actions.get(c.name).kind, c.shortcut]),
  );
  return chrome.scripting?.executeScript({
    target: { tabId: tab.id },
    func: pageSelection,
    args: ['enable', tab.url, shortcuts],
  });
}
export function registerSelectionMenu() {
  const menus = chrome.contextMenus;
  if (!menus) return;
  // Callback form also works on Chrome 116. Menus survive service-worker restarts.
  for (const [id, { title }] of actions) {
    const options = { title, contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] };
    menus.update(id, options, () => {
      if (chrome.runtime.lastError)
        menus.create({ id, ...options }, () => {
          if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
        });
    });
  }
}
async function captureSelected(tab, kind, menu) {
  const pageUrl = tab?.url || menu?.pageUrl;
  let notice;
  try {
    if (menu?.editable) throw new Error('请选择网页正文中的文字');
    if (!Number.isInteger(tab?.id) || !/^https?:\/\//i.test(pageUrl)) throw new Error('请在普通网页中摘录');
    if (menu?.pageUrl && menu.pageUrl !== pageUrl && menu.pageUrl !== menu.frameUrl)
      throw new Error('网页已切换，请重新选中文字');
    const frameUrl = menu?.frameUrl || pageUrl;
    const frames = await chrome.scripting
      .executeScript({
        target: { tabId: tab.id, frameIds: [menu?.frameId ?? 0] },
        injectImmediately: true,
        func: pageSelection,
        args: [menu ? 'read' : 'read-focused', frameUrl],
      })
      .catch(() => []);
    const live = frames[0]?.result;
    if (live?.editable) throw new Error('请选择网页正文中的文字');
    let text = live?.text,
      link = live?.sourceUrl || frameUrl;
    if (menu) {
      // The native menu can collapse whitespace. Use the matching DOM selection when accessible.
      const comparable = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
      if (live?.url !== frameUrl || !text || comparable(text) !== comparable(menu.selectionText))
        text = menu.selectionText;
    } else {
      if (live?.unavailable) throw new Error('此内嵌页面限制读取选区，请在选中文字后使用右键菜单');
      if (!live || live.url !== pageUrl || (await chrome.tabs.get(tab.id)).url !== pageUrl)
        throw new Error('无法读取当前网页的选区，请在网页正文重新选择');
    }
    const sourceUrl = /^https?:\/\//i.test(link) ? link : pageUrl;
    const result = await recordSelection({ ...tab, url: pageUrl }, text, sourceUrl, kind);
    notice = result.ok ? (result.queued ? '已暂存，等待同步到 DSH' : result.message) : result.error;
  } catch (error) {
    await feedback(tab?.id, '!', error.message);
    notice = error.message;
  }
  if (tab?.id != null && pageUrl)
    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        func: selectionNotice,
        args: [pageUrl, notice],
      })
      .catch(() => {});
}

export function selectionMenuClick(info, tab) {
  const action = actions.get(info.menuItemId);
  if (action) return captureSelected(tab, action.kind, info);
}

export async function selectionShortcut(command, tab) {
  const action = actions.get(command);
  if (!action) return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return captureSelected(tab, action.kind);
}
