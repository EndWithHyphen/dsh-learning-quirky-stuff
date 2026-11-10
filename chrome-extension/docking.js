import { mountBottomDrawer, removeBottomDrawer, revealBottomDrawer } from './bottom-drawer.js';
const ready = new Map();
const key = (id) => 'dock:' + id;
export async function validateBottom(message, sender) {
  if (!sender.tab?.id || !sender.frameId) return null;
  const value = (await chrome.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)];
  if (
    !value ||
    value.session !== message.session ||
    (message.action !== 'close-bottom' && sender.tab.url !== value.context.url)
  )
    return null;
  const url = new URL(sender.url || 'https://invalid');
  if (
    url.href.split('?')[0] !== chrome.runtime.getURL('sidepanel.html') ||
    url.searchParams.get('session') !== value.session
  )
    return null;
  return value;
}
export async function openBottom(context) {
  const [tab] = await chrome.tabs.query({ active: true, windowId: context.windowId });
  if (!tab || tab.id !== context.tabId || tab.url !== context.url)
    throw new Error('请先回到这篇笔记对应的网页，再打开底部面板');
  const previous = (await chrome.storage.session.get(key(tab.id)))[key(tab.id)];
  if (previous?.context.url === context.url) {
    const [existing] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: revealBottomDrawer,
    });
    if (existing?.result) {
      if (previous.context.id === context.id) {
        if (chrome.sidePanel.close) await chrome.sidePanel.close({ tabId: context.tabId }).catch(() => {});
        return { ok: true, reused: true };
      }
      const saved = await chrome.runtime
        .sendMessage({ action: 'prepare-dock-close', session: previous.session })
        .catch(() => null);
      if (!saved?.ok) throw new Error(saved?.error || '请先保存并关闭底部正在编辑的笔记');
    }
  }
  const { dockHeight } = await chrome.storage.local.get('dockHeight'),
    session = crypto.randomUUID();
  await chrome.storage.session.set({ [key(tab.id)]: { session, context } });
  let timer;
  const loaded = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('当前网页无法打开底部面板，请继续使用侧栏')), 8000);
    ready.set(session, resolve);
  });
  // Attach the rejection handler before injection, which itself may fail.
  loaded.catch(() => {});
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: mountBottomDrawer,
      args: [
        {
          src: chrome.runtime.getURL('sidepanel.html') + '?surface=bottom&session=' + session,
          height: dockHeight,
        },
      ],
    });
    await loaded;
    if (chrome.sidePanel.close) await chrome.sidePanel.close({ tabId: context.tabId }).catch(() => {});
    return { ok: true };
  } catch (e) {
    await chrome.storage.session.remove(key(tab.id));
    await chrome.scripting
      .executeScript({ target: { tabId: tab.id }, func: removeBottomDrawer })
      .catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
    ready.delete(session);
  }
}
export async function bottomMessage(message, sender) {
  if (message.action === 'dock-height') {
    const exists =
      sender.tab?.id && (await chrome.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)];
    if (exists && Number.isFinite(message.height))
      await chrome.storage.local.set({ dockHeight: Math.max(240, Math.min(1800, message.height)) });
    return { ok: true };
  }
  const value = await validateBottom(message, sender);
  if (!value) throw new Error('请从学习画板的“底部打开”按钮进入');
  if (message.action === 'bottom-context') return { ok: true, context: value.context };
  if (message.action === 'bottom-ready') {
    ready.get(value.session)?.();
    return { ok: true };
  }
  if (message.action === 'close-bottom') {
    await chrome.storage.session.remove(key(sender.tab.id));
    // Return the acknowledgment before removing the sender's iframe.
    setTimeout(
      () =>
        chrome.scripting
          .executeScript({ target: { tabId: sender.tab.id }, func: removeBottomDrawer })
          .catch(() => {}),
      40,
    );
    return { ok: true };
  }
}
