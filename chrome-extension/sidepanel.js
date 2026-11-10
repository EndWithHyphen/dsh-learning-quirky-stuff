import { request } from './bridge.js';
import { draftPurge } from './drafts.js';
import { createPreviewPanel } from './preview-panel.js';
import { tabNoteKey } from './tab-notes.js';
const panelURL = new URL(window.location.href),
  isBottom = panelURL.searchParams.get('surface') === 'bottom',
  dockSession = panelURL.searchParams.get('session');
let dockContext = null;
if (isBottom || window.top !== window) {
  const result = await chrome.runtime.sendMessage({ action: 'bottom-context', session: dockSession });
  if (!isBottom || !result?.ok) {
    document.body.textContent = '请通过学习画板的“底部打开”按钮进入';
    throw new Error('底部面板未获授权');
  }
  dockContext = result.context;
  document.documentElement.dataset.surface = 'bottom';
  chrome.runtime.sendMessage({ action: 'bottom-ready', session: dockSession }).catch(() => {});
}

const $ = (s) => document.querySelector(s),
  editor = $('#notes');
let current = null,
  windowId = null,
  boundTabId = isBottom
    ? dockContext.tabId
    : panelURL.searchParams.has('tabId')
      ? Number(panelURL.searchParams.get('tabId'))
      : null,
  saveTimer = null,
  loading = 0,
  screenshotBusy = false;
const imageCache = new Map(),
  purgedIds = new Set();
let canvasFocused = false,
  focusScroll = 0,
  focusToken = 0,
  focusNoticeTimer = null;
const pointerIds = new Set();
let canvasInstance = null,
  canvasTask = Promise.resolve(),
  canvasScript = null,
  mode = 'canvas',
  captureOperation = null,
  lastDeleted = null,
  imageTail = Promise.resolve(),
  openTail = Promise.resolve();
const previewPanel = createPreviewPanel($('#preview-root'));
async function refreshFeatures() {
  try {
    const result = await request('/module', { action: 'features.get' }),
      enabled = result.value.features.preview;
    $('#tab-preview').hidden = !enabled;
    if (!enabled && mode === 'preview') await setMode('canvas');
  } catch {
    $('#tab-preview').hidden = true;
  }
}
window.addEventListener('focus', refreshFeatures);
$('#tab-preview').addEventListener('click', () => setMode('preview').catch((e) => error(e.message)));
function loadCanvasScript() {
  if (window.StudyboardCanvas) return Promise.resolve();
  return (canvasScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('canvas.js');
    script.onload = resolve;
    script.onerror = () => {
      canvasScript = null;
      script.remove();
      reject(new Error('画布加载失败，请刷新扩展后重试'));
    };
    document.head.appendChild(script);
  }));
}
function ensureCanvas(c = current) {
  const task = canvasTask
    .catch(() => {})
    .then(async () => {
      if (c !== current || !c?.id) return null;
      if (canvasInstance?.id === c.id) {
        canvasInstance.refresh();
        return canvasInstance;
      }
      if (canvasInstance) {
        await canvasInstance.dispose();
        canvasInstance = null;
      }
      $('#canvas-loading').hidden = false;
      $('#canvas-loading').textContent = '正在打开手写画布…';
      try {
        await loadCanvasScript();
        if (c !== current) return null;
        const instance = await window.StudyboardCanvas.mount($('#canvas-root'), c, {
          onCapture: (mode) => {
            if (c === current) return screenshot(mode);
          },
          onFocus: (value) => setCanvasFocus(value).catch((e) => error(e.message)),
          onSaveStatus: (kind, message) => {
            if (c === current) {
              $('#focus-save-status').dataset.state = kind;
              $('#focus-save-status').title = message;
              $('#focus-save-status').setAttribute('aria-label', message);
            }
          },
          onPurged: () => handlePurged([c.id]),
          onImages: (r) => {
            c.images = r.images || c.images;
            c.deletedImages = r.deletedImages || [];
            if (c === current) showImages(c);
          },
          onFork: async (copy) => {
            const ctx = { ...c, id: copy.id, title: copy.title, status: 'ready', requestedAt: Date.now() };
            await chrome.runtime.sendMessage({ action: 'bind-tab-note', context: ctx });
            await openContext(ctx);
          },
        });
        if (c !== current) {
          await instance.dispose();
          return null;
        }
        canvasInstance = instance;
        $('#canvas-loading').hidden = true;
        instance.refresh();
        refreshButtons();
        return instance;
      } catch (e) {
        $('#canvas-loading').textContent = e.message;
        throw e;
      }
    });
  canvasTask = task;
  return task;
}
async function setMode(value) {
  if (value !== 'canvas' && canvasFocused) await setCanvasFocus(false);
  mode = value;
  $('#canvas-section').hidden = mode !== 'canvas';
  $('#notes-section').hidden = mode !== 'notes';
  $('#preview-section').hidden = mode !== 'preview';
  $('#tab-canvas').setAttribute('aria-selected', String(mode === 'canvas'));
  $('#tab-notes').setAttribute('aria-selected', String(mode === 'notes'));
  $('#tab-preview').setAttribute('aria-selected', String(mode === 'preview'));
  await chrome.storage.local.set({ studyboardMode: mode });
  if (mode === 'canvas' && current?.id) await ensureCanvas();
  else if (mode === 'notes') editor.focus({ preventScroll: true });
  else if (mode === 'preview') {
    await previewPanel.setContext(current);
    await previewPanel.refreshModels();
  }
}
function afterPaint() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 100);
    if (window.requestAnimationFrame)
      window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
}
async function setCanvasFocus(value) {
  const token = ++focusToken,
    c = current;
  if (value) {
    if (!c?.id) return;
    if (mode !== 'canvas') await setMode('canvas');
    else await ensureCanvas(c);
    if (token !== focusToken || current !== c) return;
  }
  const instance = canvasInstance,
    view = instance?.viewport?.();
  if (value && !canvasFocused) focusScroll = window.scrollY || 0;
  canvasFocused = value;
  document.documentElement.classList.toggle('canvas-focus', value);
  $('#canvas-focus-toolbar').hidden = !value;
  clearTimeout(focusNoticeTimer);
  $('#focus-notice').hidden = true;
  refreshButtons();
  await afterPaint();
  if (token !== focusToken) return;
  if (!value && window.scrollTo && (window.scrollY || 0) !== focusScroll) window.scrollTo(0, focusScroll);
  if (instance && canvasInstance === instance) {
    instance.resizeViewport?.(view);
    instance.refresh();
    instance.focusCanvas?.();
  }
}
$('#focus-exit').addEventListener('click', () => setCanvasFocus(false).catch((e) => error(e.message)));
$('#focus-help').addEventListener('click', () => canvasInstance?.showShortcuts?.());
$('#focus-learning').addEventListener('click', () => canvasInstance?.showLearningTools?.());
$('#focus-error-close').addEventListener('click', () => error());
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target.closest?.('.canvas-engine')) pointerIds.add(e.pointerId);
  },
  true,
);
for (const name of ['pointerup', 'pointercancel'])
  document.addEventListener(name, (e) => pointerIds.delete(e.pointerId), true);
window.addEventListener('blur', () => pointerIds.clear());
$('#tab-canvas').addEventListener('click', () => setMode('canvas').catch((e) => error(e.message)));
$('#tab-notes').addEventListener('click', () => setMode('notes').catch((e) => error(e.message)));
function withCanvas(c, operation, focusId) {
  const task = imageTail
    .catch(() => {})
    .then(async () => {
      await canvasTask.catch(() => {});
      const canvas = canvasInstance?.id === c.id ? canvasInstance : null;
      try {
        canvas?.setBusy(true);
        await canvas?.flush();
        const r = await operation();
        if (canvas && canvas === canvasInstance)
          await canvas.reload(typeof focusId === 'function' ? focusId(r) : focusId);
        return r;
      } finally {
        canvas?.setBusy(false);
      }
    });
  imageTail = task;
  return task;
}
async function cancelCapture() {
  const op = captureOperation;
  if (!op) return;
  op.cancelled = true;
  $('#cancel-capture').disabled = true;
  $('#focus-cancel-capture').disabled = true;
  status('正在取消截图…');
  try {
    await chrome.runtime.sendMessage({ action: 'cancel-capture', tabId: op.tabId, captureId: op.id });
  } catch {}
}
$('#cancel-capture').addEventListener('click', cancelCapture);
document.addEventListener(
  'keydown',
  (e) => {
    const plainEscape = e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plainEscape && captureOperation) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelCapture();
      return;
    }
    const dialog = e.target.closest?.('[role="dialog"]') || document.querySelector('dialog[open]'),
      placing = $('#canvas-root').dataset.learningPlacement;
    if (
      e.altKey &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.isComposing &&
      ['KeyS', 'KeyV', 'KeyF'].includes(e.code) &&
      current?.id &&
      !dialog &&
      !placing
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'KeyF') {
        setCanvasFocus(!canvasFocused).catch((e) => error(e.message));
        return;
      }
      if (screenshotBusy || current.loading) return;
      const c = current,
        mode = e.code === 'KeyS' ? 'region' : 'full',
        button = $(canvasFocused ? '#focus-capture-' + mode : '#capture-' + mode);
      button.focus({ preventScroll: true });
      afterPaint()
        .then(() => {
          if (current === c) return screenshot(mode);
        })
        .catch((e) => error(e.message));
      return;
    }
    if (
      plainEscape &&
      canvasFocused &&
      !dialog &&
      !placing &&
      !pointerIds.size &&
      !e.target.closest?.('input,textarea,select,[contenteditable="true"]') &&
      !canvasInstance?.isInteracting?.()
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setCanvasFocus(false).catch((e) => error(e.message));
    }
  },
  true,
);

async function handlePurged(ids) {
  ids.forEach((id) => purgedIds.add(id));
  for (const [imageId, cached] of imageCache) if (ids.includes(cached.noteId)) imageCache.delete(imageId);
  const dialog = $('#image-dialog');
  if (ids.includes(dialog.dataset.noteId)) {
    if (dialog.open) dialog.close();
    $('#large-image').removeAttribute('src');
    delete dialog.dataset.imageId;
    delete dialog.dataset.noteId;
  }
  if (!current?.id || !ids.includes(current.id)) return;
  setCanvasFocus(false).catch(() => {});
  const c = current;
  c.dirty = false;
  current = null;
  loading++;
  clearTimeout(saveTimer);
  const instance = canvasInstance;
  canvasInstance = null;
  editor.value = '';
  editor.disabled = true;
  imageCache.clear();
  $('#pending-image').replaceChildren();
  $('#pending-image').hidden = true;
  $('#title').textContent = '';
  $('#source').textContent = '';
  $('#source').removeAttribute('href');
  $('#gallery').replaceChildren();
  $('#deleted-gallery').replaceChildren();
  $('#workspace').hidden = true;
  $('#empty').hidden = false;
  $('#empty h1').textContent = '这篇笔记已永久删除';
  $('#empty p').textContent = '按快捷键或点击扩展图标，可以为当前网页创建新的笔记。';
  refreshButtons();
  await instance?.dispose({ discard: true });
  await draftPurge(ids);
  const stored = (await chrome.storage.local.get(draftKey(c)))[draftKey(c)];
  if (stored?.noteId === c.id) await chrome.storage.local.remove(draftKey(c));
  chrome.runtime.sendMessage({ action: 'sync-purged' }).catch(() => {});
}
function status(message, saving = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('saving', saving);
  if (canvasFocused) {
    $('#focus-notice').textContent = message;
    $('#focus-notice').hidden = false;
    clearTimeout(focusNoticeTimer);
    if (!saving)
      focusNoticeTimer = setTimeout(() => {
        $('#focus-notice').hidden = true;
      }, 2600);
  }
}
function error(message = '') {
  $('#error').textContent = message;
  $('#error').hidden = !message;
  $('#focus-error span').textContent = message;
  $('#focus-error').hidden = !message;
}
function draftKey(c) {
  return c.id ? 'draft:note:' + c.id : 'draft:tab:' + c.tabId + ':' + (c.requestId || c.url);
}
async function persist(c) {
  if (c.id && purgedIds.has(c.id)) return;
  const value = {
    text: c.text,
    baseVersion: c.version,
    noteId: c.id,
    url: c.url,
    tabId: c.tabId,
    requestId: c.requestId,
    writeId: c.writeId,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [draftKey(c)]: value });
}
async function clearDraft(c, writeId) {
  const key = draftKey(c),
    saved = (await chrome.storage.local.get(key))[key];
  if (saved?.writeId === writeId) await chrome.storage.local.remove(key);
  if (c.draftSourceKey && c.draftSourceKey !== key) {
    const source = (await chrome.storage.local.get(c.draftSourceKey))[c.draftSourceKey];
    if (source?.writeId === c.draftSourceWriteId) await chrome.storage.local.remove(c.draftSourceKey);
  }
}
function refreshButtons() {
  for (const id of ['#capture-full', '#capture-region', '#focus-capture-full', '#focus-capture-region'])
    $(id).disabled = !current?.id || current.loading || screenshotBusy;
  for (const button of document.querySelectorAll('.image-actions button,#undo-image'))
    button.disabled = screenshotBusy;
  $('#save').disabled = !current || !!current.saving;
  $('#dock-mode').disabled = !current?.id || current.loading || screenshotBusy;
  $('#close-dock').disabled = screenshotBusy;
  $('#focus-help').disabled = !canvasInstance;
  $('#focus-learning').disabled = !canvasInstance;
  $('#focus-exit').disabled = false;
  $('#focus-cancel-capture').hidden = !canvasFocused || !captureOperation;
}
function showContext(c) {
  previewPanel.setContext(c).catch(() => {});
  $('#focus-note-title').textContent = c.title || '网页笔记';
  if (isBottom) {
    $('.brand strong').textContent = c.title || '边看边记';
    $('.brand strong').title = c.url;
  }
  $('#empty').hidden = true;
  $('#workspace').hidden = false;
  $('#title').textContent = c.title || '网页笔记';
  $('#source').textContent = c.url;
  $('#source').href = c.url;
  $('#conflict').hidden = !c.conflict;
  refreshButtons();
}
function counter() {
  $('#count').textContent = `${editor.value.length} 字`;
}
function showImages(c) {
  const gallery = $('#gallery'),
    deleted = $('#deleted-gallery');
  gallery.replaceChildren();
  deleted.replaceChildren();
  $('#images-section').hidden = !c.images?.length && !c.deletedImages?.length;
  $('#image-count').textContent = c.images?.length || 0;
  $('#deleted-section').hidden = !c.deletedImages?.length;
  $('#deleted-count').textContent = `已删除的截图 · ${c.deletedImages?.length || 0}`;
  $('#image-undo').hidden =
    lastDeleted?.noteId !== c.id || !c.deletedImages?.some((i) => i.id === lastDeleted.imageId);
  for (const image of [...(c.images || []), ...(c.deletedImages || [])].reverse()) {
    const isDeleted = !!image.deletedAt,
      article = document.createElement('article');
    article.className = 'image-card';
    const button = document.createElement('button'),
      img = document.createElement('img');
    img.src = image.preview || '';
    img.alt = image.caption || '页面截图';
    button.setAttribute('aria-label', '查看' + img.alt);
    button.appendChild(img);
    button.addEventListener('click', async () => {
      const dialog = $('#image-dialog');
      dialog.dataset.imageId = image.id;
      dialog.dataset.noteId = c.id;
      $('#large-image').src = imageCache.get(image.id)?.dataURL || image.preview;
      dialog.showModal();
      try {
        if (!imageCache.has(image.id)) {
          const full = await request('/note/image/get', { id: c.id, url: c.url, imageId: image.id });
          if (purgedIds.has(c.id)) return;
          imageCache.set(image.id, { dataURL: full.dataURL, noteId: c.id });
        }
        if (dialog.dataset.imageId === image.id)
          $('#large-image').src = imageCache.get(image.id)?.dataURL || '';
      } catch (e) {
        error(e.message);
      }
    });
    article.appendChild(button);
    const meta = document.createElement('div'),
      label = document.createElement('span'),
      time = document.createElement('span');
    label.textContent = image.caption || '页面截图';
    if (image.videoTime != null)
      label.textContent += ` · 视频 ${Math.floor(image.videoTime / 60)}:${String(Math.floor(image.videoTime % 60)).padStart(2, '0')}`;
    time.textContent = new Date(image.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    meta.append(label, time);
    article.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'image-actions';
    if (!isDeleted) {
      const draw = document.createElement('button');
      draw.textContent = '在画布上标注';
      draw.onclick = async () => {
        try {
          await setMode('canvas');
          canvasInstance?.focus(image.id);
          $('#canvas-section').scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (e) {
          error(e.message);
        }
      };
      actions.appendChild(draw);
      const noteButton = document.createElement('button');
      noteButton.textContent = image.note ? '编辑备注' : '添加备注';
      noteButton.onclick = async () => {
        try {
          await setMode('canvas');
          const canvas = await ensureCanvas();
          canvas?.openImageNote?.(image.id);
        } catch (e) {
          error(e.message);
        }
      };
      actions.appendChild(noteButton);
    }
    const remove = document.createElement('button');
    remove.textContent = isDeleted ? '恢复截图' : '删除';
    remove.className = isDeleted ? 'restore-image' : 'delete-image';
    remove.onclick = () => changeImage(c, image.id, !isDeleted);
    actions.appendChild(remove);
    article.appendChild(actions);
    if (image.note) {
      const note = document.createElement('details'),
        summary = document.createElement('summary'),
        body = document.createElement('p');
      note.className = 'image-note';
      summary.textContent = '图片备注';
      body.textContent = image.note;
      note.append(summary, body);
      article.appendChild(note);
    }
    (isDeleted ? deleted : gallery).appendChild(article);
  }
  refreshButtons();
}
async function changeImage(c, imageId, deleted) {
  if (screenshotBusy) return;
  screenshotBusy = true;
  refreshButtons();
  error();
  try {
    const result = await withCanvas(
      c,
      () =>
        request(deleted ? '/note/image/delete' : '/note/image/restore', { id: c.id, url: c.url, imageId }),
      deleted ? null : imageId,
    );
    c.images = result.images;
    c.deletedImages = result.deletedImages;
    if (deleted) lastDeleted = { noteId: c.id, imageId };
    if (c === current) {
      showImages(c);
      status(deleted ? '截图已删除，可以撤销或在已删除的截图中恢复' : '截图已恢复到原来的位置');
    }
  } catch (e) {
    error(e.message);
  } finally {
    screenshotBusy = false;
    refreshButtons();
  }
}
$('#undo-image').addEventListener('click', () => {
  if (current && lastDeleted?.noteId === current.id) changeImage(current, lastDeleted.imageId, false);
});
function openContext(ctx) {
  const task = openTail.catch(() => {}).then(() => loadContext(ctx));
  openTail = task;
  return task;
}
async function loadContext(ctx) {
  if (!ctx?.url) return;
  const known = (await chrome.storage.local.get('purgedNotes')).purgedNotes || [];
  known.forEach((id) => purgedIds.add(id));
  if (ctx.id && known.includes(ctx.id)) {
    await handlePurged([ctx.id]);
    return;
  }
  if (current?.url === ctx.url && current.tabId === ctx.tabId && (!ctx.id || ctx.id === current.id)) {
    if (current.id) {
      current.title = ctx.title || current.title;
      current.windowId = ctx.windowId;
      current.requestId = ctx.requestId;
      windowId = ctx.windowId;
      showContext(current);
      if (!current.saving && !current.dirty) status('已打开当前网页的笔记');
      if (mode === 'notes' && Date.now() - (ctx.requestedAt || Date.now()) < 5000)
        editor.focus({ preventScroll: true });
      return;
    }
    if (!ctx.id) {
      status(ctx.status === 'queued' ? '草稿保存在 Chrome，等待 DSH 连接' : '正在准备当前页笔记…', true);
      return;
    }
  }
  if (captureOperation) await cancelCapture();
  editor.disabled = true;
  canvasInstance?.setBusy(true);
  await canvasTask.catch(() => {});
  if (canvasInstance) {
    try {
      await canvasInstance.flush();
    } catch {}
    await canvasInstance.dispose();
    canvasInstance = null;
  }
  if (current?.dirty) {
    await persist(current).catch(() => {});
    sync(current).catch((e) => error(e.message));
  }
  const generation = ++loading,
    c = {
      ...ctx,
      text: '',
      version: 0,
      sequence: 0,
      dirty: false,
      saving: false,
      images: [],
      deletedImages: [],
      loading: true,
      writeId: crypto.randomUUID(),
      conflict: null,
    };
  current = c;
  editor.disabled = true;
  editor.value = '';
  showContext(c);
  $('#pending-image').hidden = true;
  error();
  status('正在打开笔记…', true);
  $('#canvas-loading').hidden = false;
  $('#canvas-loading').textContent = c.id ? '正在准备画布…' : '打开 DSH 后可使用手写画布';
  let stored;
  try {
    const keys = [
      draftKey(c),
      'draft:tab:' + c.tabId + ':' + c.requestId,
      'draft:' + windowId + ':' + c.id,
      'draft:' + windowId + ':' + c.requestId,
      'draft:' + windowId + ':' + c.url,
    ];
    for (const key of [...new Set(keys)]) {
      const candidate = (await chrome.storage.local.get(key))[key];
      if (candidate && (!candidate.noteId || candidate.noteId === c.id) && !purgedIds.has(candidate.noteId)) {
        stored = candidate;
        c.draftSourceKey = key;
        c.draftSourceWriteId = candidate.writeId;
        break;
      }
    }
  } catch {}
  let note = null;
  if (c.id)
    try {
      note = await request('/note/get', { id: c.id, url: c.url });
    } catch (e) {
      if (e.code === 'NOTE_PURGED') {
        await handlePurged([c.id]);
        return;
      }
      if (generation === loading) error(e.message);
    }
  if (generation !== loading) return;
  if (note) {
    c.version = note.webNotes.version;
    c.text = note.webNotes.text;
    c.images = note.images;
    c.deletedImages = note.deletedImages || [];
    c.title = note.title;
  }
  if (stored && (!stored.noteId || stored.noteId === c.id)) {
    c.text = stored.text;
    c.writeId = stored.writeId || crypto.randomUUID();
    c.dirty = true;
    c.version = stored.noteId === c.id ? stored.baseVersion : c.version;
  }
  editor.value = c.text;
  c.loading = false;
  editor.disabled = false;
  counter();
  showContext(c);
  showImages(c);
  if (mode === 'notes' && Date.now() - (ctx.requestedAt || Date.now()) < 5000)
    editor.focus({ preventScroll: true });
  if (c.dirty) {
    status('已恢复本机草稿，正在同步…', true);
    sync(c).catch((e) => error(e.message));
  } else
    status(
      c.id
        ? ctx.reused
          ? '已打开当前网页的笔记'
          : '笔记已创建，可以开始记录'
        : '草稿先保存在 Chrome，等待 DSH 连接',
    );
  if (c.id && mode === 'canvas') ensureCanvas(c).catch((e) => error(e.message));
  if (c.id) {
    const all = await chrome.storage.local.get(null);
    for (const [key, item] of Object.entries(all)) {
      if (key.startsWith('pending-screenshot:') && item.id === c.id && item.url === c.url) {
        await uploadImage(c, item);
        if (c !== current) break;
      }
    }
  }
}
async function sync(c = current) {
  if (!c || !c.dirty || c.saving || c.conflict || purgedIds.has(c.id)) return;
  await persist(c);
  if (!c.id) {
    if (c === current) status('草稿已保存在 Chrome，打开 DSH 后自动同步');
    return;
  }
  c.saving = true;
  if (c === current) {
    status('正在保存…', true);
    refreshButtons();
  }
  try {
    while (c.dirty && !purgedIds.has(c.id)) {
      const seq = c.sequence,
        value = c.text,
        writeId = c.writeId;
      const result = await request('/note/save', {
        id: c.id,
        url: c.url,
        text: value,
        baseVersion: c.version,
      });
      c.version = result.webNotes.version;
      if (c.sequence === seq) {
        c.dirty = false;
        await clearDraft(c, writeId);
      }
      if (c === current) {
        error();
        status('已保存到 DSH · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    }
  } catch (e) {
    if (e.code === 'NOTE_PURGED') {
      c.dirty = false;
      await handlePurged([c.id]);
      return;
    }
    if (e.code === 'NOTE_CONFLICT') c.conflict = e.latest;
    if (c === current) {
      error(e.message);
      status('草稿已保存在 Chrome');
      $('#conflict').hidden = !c.conflict;
    }
  } finally {
    c.saving = false;
    if (c === current) refreshButtons();
  }
}
editor.addEventListener('input', () => {
  if (!current) return;
  current.text = editor.value;
  current.sequence++;
  current.writeId = crypto.randomUUID();
  current.dirty = true;
  counter();
  status('正在保存草稿…', true);
  persist(current).catch((e) => error('本机草稿保存失败：' + e.message));
  clearTimeout(saveTimer);
  const c = current;
  saveTimer = setTimeout(() => sync(c).catch((e) => error(e.message)), 650);
});
$('#save').addEventListener('click', () => sync().catch((e) => error(e.message)));
$('#retry').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ action: 'flush' });
    if (current?.dirty) await sync();
    else if (current) await reloadCurrent();
    error();
  } catch (e) {
    error(e.message);
  }
});
async function reloadCurrent() {
  if (!current?.id) return;
  const c = current,
    note = await request('/note/get', { id: c.id, url: c.url });
  if (c !== current) return;
  c.images = note.images;
  c.deletedImages = note.deletedImages || [];
  showImages(c);
  if (canvasInstance?.id === c.id) {
    await canvasInstance.reload();
  } else if (mode === 'canvas') await ensureCanvas(c);
  if (!c.dirty) {
    c.version = note.webNotes.version;
    c.text = note.webNotes.text;
    editor.value = c.text;
    counter();
  }
  status('已连接，内容已同步');
}
$('#use-remote').addEventListener('click', async () => {
  if (!current?.conflict) return;
  const c = current;
  await chrome.storage.local.set({
    [draftKey(c) + ':backup']: { text: c.text, noteId: c.id, url: c.url, updatedAt: Date.now() },
  });
  c.text = c.conflict.text;
  c.version = c.conflict.version;
  c.conflict = null;
  c.dirty = false;
  await chrome.storage.local.remove(draftKey(c));
  editor.value = c.text;
  counter();
  showContext(c);
  error();
  status('已采用 DSH 中的版本');
});
$('#fork').addEventListener('click', async () => {
  if (!current) return;
  const c = current;
  try {
    const r = await request('/capture', {
      requestId: crypto.randomUUID(),
      url: c.url,
      title: c.title + '（草稿）',
      reuse: false,
    });
    c.draftSourceKey = draftKey(c);
    c.draftSourceWriteId = c.writeId;
    c.id = r.id;
    c.title = r.title;
    c.version = 0;
    c.conflict = null;
    c.dirty = true;
    c.writeId = crypto.randomUUID();
    await persist(c);
    await chrome.runtime.sendMessage({
      action: 'bind-tab-note',
      context: {
        id: c.id,
        title: c.title,
        url: c.url,
        tabId: c.tabId,
        windowId: c.windowId,
        requestId: c.requestId,
        status: 'ready',
      },
    });
    showContext(c);
    error();
    await sync(c);
  } catch (e) {
    error(e.message);
  }
});
async function uploadImage(c, image) {
  const item = { ...image, id: c.id, url: c.url, requestId: image.requestId || crypto.randomUUID() };
  let cached = false;
  try {
    await chrome.storage.local.set({ [`pending-screenshot:${item.requestId}`]: item });
    cached = true;
  } catch {}
  const pending = $('#pending-image');
  pending.hidden = false;
  pending.replaceChildren();
  const note = document.createElement('p');
  note.textContent = '正在保存截图…';
  pending.appendChild(note);
  const preview = document.createElement('img');
  preview.src = item.preview || item.dataURL;
  pending.appendChild(preview);
  try {
    const result = await withCanvas(
      c,
      () => request('/note/image', item),
      (r) => r.image.id,
    );
    await chrome.storage.local.remove(`pending-screenshot:${item.requestId}`);
    imageCache.set(result.image.id, { dataURL: item.dataURL, noteId: c.id });
    const fresh = await request('/note/get', { id: c.id, url: c.url });
    c.images = fresh.images;
    c.deletedImages = fresh.deletedImages || [];
    if (c === current) {
      showImages(c);
      pending.hidden = true;
      status('截图已放进画布，可以直接圈画和手写');
      error();
      request('/client-event', {
        kind: 'screenshot-saved',
        version: chrome.runtime.getManifest().version,
      }).catch(() => {});
    }
  } catch (e) {
    if (e.code === 'NOTE_PURGED') {
      await handlePurged([c.id]);
      return;
    }
    if (c === current) {
      note.textContent = cached
        ? '截图已暂存在 Chrome。可重试，或先下载留存。'
        : '截图尚未同步且未能暂存，请保持面板打开，重试或下载留存。';
      const retry = document.createElement('button');
      retry.textContent = '重试保存';
      retry.onclick = () => uploadImage(c, item);
      const download = document.createElement('button');
      download.textContent = '下载截图';
      download.onclick = () => {
        const a = document.createElement('a');
        a.href = item.dataURL;
        a.download = item.dataURL.startsWith('data:image/jpeg') ? '学习截图.jpg' : '学习截图.png';
        a.click();
      };
      pending.append(retry, download);
      error(e.message);
    }
  }
}
async function screenshot(mode) {
  if (!current?.id || current.loading || screenshotBusy) return;
  const c = current;
  screenshotBusy = true;
  refreshButtons();
  error();
  const op = { id: crypto.randomUUID(), tabId: c.tabId, cancelled: false };
  captureOperation = mode === 'region' ? op : null;
  $('#cancel-capture').hidden = mode !== 'region';
  $('#cancel-capture').disabled = false;
  $('#focus-cancel-capture').disabled = false;
  refreshButtons();
  status(mode === 'region' ? '在网页上拖动选择区域，Esc 或“取消截图”可取消' : '正在截取当前可见页面…', true);
  try {
    const r = await chrome.runtime.sendMessage({
      action: 'capture-screen',
      mode,
      tabId: c.tabId,
      windowId: c.windowId,
      url: c.url,
      captureId: op.id,
    });
    captureOperation = null;
    $('#cancel-capture').hidden = true;
    refreshButtons();
    if (op.cancelled || r?.cancelled) {
      status('已取消截图');
      return;
    }
    if (!r?.ok) throw new Error(r?.error || '截图未完成');
    await uploadImage(c, { ...r, caption: mode === 'region' ? '区域截图' : '可见页截图' });
  } catch (e) {
    error(e.message);
    status('截图未保存');
  } finally {
    captureOperation = null;
    $('#cancel-capture').hidden = true;
    screenshotBusy = false;
    refreshButtons();
    if (current === c) {
      if (!$('#canvas-section').hidden) canvasInstance?.focusCanvas?.();
      else editor.focus({ preventScroll: true });
    }
  }
}
$('#capture-region').addEventListener('click', () => screenshot('region'));
$('#capture-full').addEventListener('click', () => screenshot('full'));
$('#focus-capture-region').addEventListener('click', () => screenshot('region'));
$('#focus-capture-full').addEventListener('click', () => screenshot('full'));
$('#focus-cancel-capture').addEventListener('click', cancelCapture);
const shotKeys = /Mac|iPhone|iPad/.test(navigator.platform || '')
  ? { region: '⌥⇧S', full: '⌥⇧V' }
  : { region: 'Alt⇧S', full: 'Alt⇧V' };
for (const el of document.querySelectorAll('[data-shot-key]')) el.textContent = shotKeys[el.dataset.shotKey];
editor.addEventListener('paste', async (event) => {
  const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  if (!current?.id) {
    error('请先打开 DSH 完成连接，再粘贴图片');
    return;
  }
  const c = current;
  try {
    const bitmap = await createImageBitmap(file),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const small = document.createElement('canvas'),
      scale = Math.min(1, 600 / canvas.width);
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    await uploadImage(c, {
      dataURL: canvas.toDataURL('image/png'),
      preview: small.toDataURL('image/jpeg', 0.75),
      width: canvas.width,
      height: canvas.height,
      caption: '粘贴的截图',
    });
  } catch (e) {
    error(e.message);
  }
});
$('#close-image').addEventListener('click', () => $('#image-dialog').close());
async function saveBeforeDocking() {
  await canvasTask.catch(() => {});
  await sync();
  if (current?.dirty) throw new Error('请先完成随手记同步，再切换面板');
  await canvasInstance?.flush();
}
chrome.runtime.onMessage?.addListener((message, sender, reply) => {
  if (isBottom && sender.id === chrome.runtime.id && message.session === dockSession) {
    if (message.action === 'purge-dock') {
      handlePurged(message.ids).then(
        () => reply({ ok: true }),
        () => reply({ ok: true }),
      );
      return true;
    }
    if (message.action === 'prepare-dock-close') {
      saveBeforeDocking().then(
        () => reply({ ok: true }),
        (e) => reply({ ok: false, error: e.message }),
      );
      return true;
    }
  }
});
$('#dock-mode').textContent = isBottom ? '切回侧栏' : '底部打开';
$('#dock-mode').title = isBottom ? '切回 Chrome 侧边笔记栏' : '从网页底部打开笔记';
$('#close-dock').hidden = !isBottom;
$('#dock-mode').addEventListener('click', async () => {
  if (!current?.id) return;
  const opening = isBottom ? chrome.sidePanel.open({ tabId: current.tabId }) : null;
  opening?.catch(() => {});
  $('#dock-mode').disabled = true;
  try {
    await saveBeforeDocking();
    const context = {
      id: current.id,
      title: current.title,
      url: current.url,
      tabId: current.tabId,
      windowId: current.windowId,
      requestId: current.requestId,
      status: 'ready',
      reused: true,
    };
    let result;
    if (isBottom) {
      await chrome.runtime.sendMessage({ action: 'bind-tab-note', context });
      await opening;
      result = await chrome.runtime.sendMessage({ action: 'close-bottom', session: dockSession });
    } else result = await chrome.runtime.sendMessage({ action: 'open-bottom', context });
    if (!result?.ok) throw new Error(result?.error || '面板切换未完成');
  } catch (e) {
    error(e.message);
  } finally {
    refreshButtons();
  }
});
$('#close-dock').addEventListener('click', async () => {
  try {
    await saveBeforeDocking();
    const result = await chrome.runtime.sendMessage({ action: 'close-bottom', session: dockSession });
    if (!result?.ok) throw new Error(result?.error || '关闭未完成');
  } catch (e) {
    error(e.message);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.purgedNotes?.newValue)
    handlePurged(changes.purgedNotes.newValue).catch(() => {});
  if (area === 'session' && boundTabId != null && changes[tabNoteKey(boundTabId)]?.newValue)
    openContext(changes[tabNoteKey(boundTabId)].newValue).catch((e) => error(e.message));
});

window.addEventListener('beforeunload', () => {
  if (captureOperation) cancelCapture();
  if (current?.dirty) persist(current).catch(() => {});
  canvasInstance?.persist?.().catch(() => {});
});
window.addEventListener('focus', () => {
  if (current?.id && !current.dirty && !canvasInstance?.dirty && !screenshotBusy)
    reloadCurrent().catch(() => {});
});
chrome.runtime.sendMessage({ action: 'sync-purged' }).catch(() => {});
const win = await chrome.windows.getCurrent();
windowId = win.id;
request('/client-event', { kind: 'panel-open', version: chrome.runtime.getManifest().version }).catch(
  () => {},
);
const preference = await chrome.storage.local.get('studyboardMode');
if (preference.studyboardMode === 'notes') await setMode('notes');
if (dockContext) {
  boundTabId = dockContext.tabId;
  await openContext(dockContext);
} else {
  const result = await chrome.runtime.sendMessage({ action: 'panel-context', tabId: boundTabId, windowId });
  if (result?.tabId != null) boundTabId = result.tabId;
  if (result?.context) await openContext(result.context);
}

setInterval(() => {
  chrome.runtime.sendMessage({ action: 'sync-purged' }).catch(() => {});
  if (current?.dirty && !current.conflict) sync().catch((e) => error(e.message));
}, 10000);

refreshFeatures();

setInterval(refreshFeatures, 15000);
