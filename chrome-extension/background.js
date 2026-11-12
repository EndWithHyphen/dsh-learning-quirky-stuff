import { request } from './bridge.js';
import { selectRegion, cancelRegion } from './region-selection.js';
import { hideBottomDrawer } from './bottom-drawer.js';
import { openBottom, bottomMessage } from './docking.js';
import { syncPurged } from './purged.js';
import {
  tabNoteKey,
  tabContext,
  readTabNote,
  updateTabNote,
  configureTab,
  openTabPanel,
  forgetTabPanel,
  configureExistingTabs,
  panelContext,
} from './tab-notes.js';
let flushing = false,
  queueTail = Promise.resolve();
async function badge(text, color = '#527b69') {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}
function updateQueue(fn) {
  const p = queueTail.then(async () => {
    const { queue = [] } = await chrome.storage.local.get('queue');
    const next = fn(queue);
    await chrome.storage.local.set({ queue: next });
    return next;
  });
  queueTail = p.catch(() => {});
  return p;
}
async function updateReading(item, result, error) {
  if (item.tabId == null) return;
  await updateTabNote(item.tabId, (current) =>
    !current || current.requestId !== item.requestId
      ? current
      : {
          ...current,
          ...(result
            ? {
                id: result.id,
                title: result.title,
                url: result.url || item.url,
                status: 'ready',
                reused: result.reused,
              }
            : { status: 'queued', error: error || '等待 DSH 连接' }),
        },
  );
}
async function flush() {
  if (flushing) return;
  flushing = true;
  let failed = false;
  try {
    const { queue = [] } = await chrome.storage.local.get('queue');
    if (!queue.length) return;
    for (const item of queue) {
      try {
        const result = await request('/capture', item);
        await updateReading(item, result);
        await updateQueue((current) => current.filter((v) => v.requestId !== item.requestId));
        await chrome.storage.local.set({
          lastStatus: result.reused ? `已打开：${result.title}` : `已创建：${result.title}`,
          lastError: null,
        });
      } catch (e) {
        if (e.code === 'NOTE_PURGED') {
          await updateQueue((current) => current.filter((v) => v.requestId !== item.requestId));
          await syncPurged({ updateQueue }).catch(() => {});
          continue;
        }
        await updateReading(item, null, e.message);
        throw e;
      }
    }
    const { queue: remaining = [] } = await chrome.storage.local.get('queue');
    await badge(remaining.length ? String(remaining.length) : '✓');
  } catch (e) {
    failed = true;
    await chrome.storage.local.set({
      lastError: e.message,
      lastStatus: '笔记已在本机排队，打开 DSH 后自动同步',
    });
    const { queue = [] } = await chrome.storage.local.get('queue');
    await badge(String(queue.length || '!'), '#b77731');
  } finally {
    flushing = false;
    if (!failed) {
      const { queue = [] } = await chrome.storage.local.get('queue');
      if (queue.length) flush();
    }
  }
}
function activate(tab) {
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    badge('!', '#b77731');
    chrome.storage.local.set({ lastError: '请在文章或视频网页上使用快捷键' });
    return;
  }
  // Open before any storage or network wait, while the user gesture is active.
  const opening = openTabPanel(tab.id);
  const item = {
    requestId: crypto.randomUUID(),
    title: tab.title || '网页笔记',
    url: tab.url,
    tabId: tab.id,
    windowId: tab.windowId,
    reuse: true,
    requestedAt: Date.now(),
  };
  Promise.resolve(opening).then(
    () => chrome.storage.local.set({ lastPanelError: null }),
    async (e) => {
      await badge('!', '#b77731');
      await chrome.storage.local.set({ lastPanelError: '侧边栏未打开，请点击扩展图标重试：' + e.message });
    },
  );
  (async () => {
    const prior = await tabContext(tab);
    if (prior?.id && prior.url === item.url) item.reuseId = prior.id;
    let queued = item;
    await updateQueue((q) => {
      const pending = q.find(
        (v) =>
          v.tabId === item.tabId &&
          v.url === item.url &&
          (!prior?.id || v.requestId === prior.requestId || v.reuseId === prior.id),
      );
      if (pending) {
        queued = pending;
        return q;
      }
      if (q.length >= 100) throw new Error('待同步笔记已达 100 篇，请打开 DSH 同步');
      return [...q, item];
    });
    await updateTabNote(tab.id, (current) =>
      current?.requestId === queued.requestId && current.id
        ? { ...current, requestedAt: Date.now() }
        : { ...queued, id: queued.reuseId || null, status: 'loading', requestedAt: Date.now() },
    );
    await flush();
  })().catch((e) => updateReading(item, null, e.message));
}
function fromUser(tab) {
  if (tab?.id != null) activate(tab);
  else chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => activate(t));
}
function pageInfo() {
  const video =
    [...document.querySelectorAll('video')].find((v) => !v.paused) || document.querySelector('video');
  return {
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    videoTime: video && Number.isFinite(video.currentTime) ? video.currentTime : null,
  };
}
async function asDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
async function captureScreen(m) {
  const dock =
    chrome.storage?.session && (await chrome.storage.session.get('dock:' + m.tabId))['dock:' + m.tabId];
  if (!dock) return capturePage(m);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: m.tabId },
      func: hideBottomDrawer,
      args: [true],
    });
    return await capturePage(m);
  } finally {
    await chrome.scripting
      .executeScript({ target: { tabId: m.tabId }, func: hideBottomDrawer, args: [false] })
      .catch(() => {});
  }
}
async function capturePage(m) {
  const [tab] = await chrome.tabs.query({ active: true, windowId: m.windowId });
  if (!tab || tab.id !== m.tabId || tab.url !== m.url)
    throw new Error('当前网页已切换，请先在要记录的网页按一次快捷键');
  let region, info;
  try {
    if (m.mode === 'region') {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: selectRegion,
        args: [m.captureId],
      });
      region = result[0]?.result;
      if (!region) return { cancelled: true };
      info = region;
    } else {
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageInfo });
      info = result[0]?.result;
    }
  } catch (e) {
    if (m.mode === 'region')
      throw new Error('此页面暂不能选择区域，请重新按快捷键授权当前页，或使用可见页截图');
  }
  const [stillActive] = await chrome.tabs.query({ active: true, windowId: m.windowId });
  if (!stillActive || stillActive.id !== m.tabId || stillActive.url !== m.url)
    throw new Error('页面已切换，截图已取消，请在要记录的页面重新操作');
  let dataURL;
  try {
    dataURL = await chrome.tabs.captureVisibleTab(m.windowId, { format: 'png' });
  } catch {
    throw new Error('请先在当前网页按一次快捷键，再点击截图');
  }
  const bitmap = await createImageBitmap(await (await fetch(dataURL)).blob());
  let x = 0,
    y = 0,
    width = bitmap.width,
    height = bitmap.height;
  if (region) {
    const scaleX = bitmap.width / region.viewportWidth,
      scaleY = bitmap.height / region.viewportHeight;
    x = Math.max(0, Math.floor(region.left * scaleX));
    y = Math.max(0, Math.floor(region.top * scaleY));
    width = Math.min(bitmap.width - x, Math.ceil(region.width * scaleX));
    height = Math.min(bitmap.height - y, Math.ceil(region.height * scaleY));
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  bitmap.close();
  let image = await canvas.convertToBlob({ type: 'image/png' });
  if (image.size > 5 * 1024 * 1024) image = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const ratio = Math.min(1, 600 / width),
    small = new OffscreenCanvas(
      Math.max(1, Math.round(width * ratio)),
      Math.max(1, Math.round(height * ratio)),
    );
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return {
    dataURL: await asDataURL(image),
    preview: await asDataURL(await small.convertToBlob({ type: 'image/jpeg', quality: 0.75 })),
    width,
    height,
    videoTime: info?.videoTime ?? null,
  };
}
chrome.commands.onCommand.addListener((name, tab) => {
  if (name === 'capture-note') fromUser(tab);
});
chrome.action.onClicked.addListener(fromUser);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'retry-capture') {
    syncPurged({ updateQueue }).catch(() => {});
    flush();
  }
});
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details?.reason === 'install') await chrome.runtime.openOptionsPage?.();
  await chrome.alarms.create('retry-capture', { periodInMinutes: 1 });
  await configureExistingTabs();
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create('retry-capture', { periodInMinutes: 1 });
  await configureExistingTabs();
  await syncPurged({ updateQueue }).catch(() => {});
  await flush();
});
chrome.tabs.onCreated?.addListener((tab) => configureTab(tab.id).catch(() => {}));
chrome.tabs.onRemoved?.addListener((id) => {
  forgetTabPanel(id);
  updateTabNote(id, () => null).catch(() => {});
});
chrome.tabs.onAttached?.addListener((id, info) =>
  updateTabNote(id, (current) => (current ? { ...current, windowId: info.newWindowId } : null)).catch(
    () => {},
  ),
);
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (['extract-material', 'focus-material'].includes(m.action)) {
    (async () => {
      const c = m.context,
        tab = await chrome.tabs.get(c.tabId);
      if (tab.url !== c.url) throw new Error('网页已切换，请在当前网页重新打开笔记');
      const bound = await readTabNote(c.tabId);
      if (bound?.id && bound.id !== c.id) throw new Error('笔记与标签页绑定已变化');
      await chrome.scripting.executeScript({ target: { tabId: c.tabId }, files: ['page-reader.js'] });
      const output = await chrome.scripting.executeScript({
        target: { tabId: c.tabId },
        func: async (action, locator) =>
          action === 'extract-material'
            ? await StudyboardPageReader.extractMaterial()
            : StudyboardPageReader.focusMaterial(locator),
        args: [m.action, m.locator || {}],
      });
      return m.action === 'extract-material'
        ? { ok: true, document: output[0].result }
        : { ok: true, ...output[0].result };
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (m.action === 'panel-context') {
    panelContext(m).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (m.action === 'bind-tab-note') {
    const c = m.context;
    if (!Number.isInteger(c?.tabId)) {
      sendResponse({ ok: false, error: '标签页无效' });
      return;
    }
    updateTabNote(c.tabId, () => ({ ...c, requestId: crypto.randomUUID() })).then((context) =>
      sendResponse({ ok: true, context }),
    );
    return true;
  }
  if (m.action === 'flush') {
    flush().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (m.action === 'sync-purged') {
    syncPurged({ updateQueue }).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (m.action === 'open-bottom') {
    openBottom(m.context).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (['bottom-context', 'bottom-ready', 'close-bottom', 'dock-height'].includes(m.action)) {
    bottomMessage(m, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (m.action === 'cancel-capture') {
    chrome.scripting
      .executeScript({ target: { tabId: m.tabId }, func: cancelRegion, args: [m.captureId] })
      .then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: true }),
      );
    return true;
  }
  if (m.action === 'capture-screen') {
    captureScreen(m).then(
      (v) => sendResponse({ ok: true, ...v }),
      (e) => sendResponse({ ok: false, error: e.message }),
    );
    return true;
  }
});
