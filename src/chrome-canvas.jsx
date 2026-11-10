import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  Excalidraw,
  MainMenu,
  restoreElements,
  CaptureUpdateAction,
  getCommonBounds,
} from '@excalidraw/excalidraw';
import css from '@excalidraw/excalidraw/index.css';
import { request } from '../chrome-extension/bridge.js';
import { draftRead, draftPut, draftDelete, draftPurge } from './drafts.js';
import { CanvasSession } from './chrome-canvas-session.js';
import { bindCanvasShortcuts, CANVAS_TOOLS, focusCanvas } from './canvas-shortcuts.js';
import CanvasShortcutHelp from './canvas-shortcut-help.jsx';
import shortcutCSS from './canvas-shortcuts.css';
import ImageText from './image-text.jsx';
import CanvasTools from './canvas-tools.jsx';
import CanvasComments from './canvas-comments.jsx';
import LearningWidgets from './learning-widgets.jsx';
import widgetCSS from './learning-widgets.css';

window.EXCALIDRAW_ASSET_PATH = chrome.runtime.getURL('assets/');
const style = document.createElement('style');
style.textContent = css + '\n' + shortcutCSS + '\n' + widgetCSS;
document.head.appendChild(style);
const cleanState = (s) => ({
  viewBackgroundColor: s.viewBackgroundColor || '#ffffff',
  gridSize: s.gridSize || null,
  gridStep: s.gridStep || 5,
});
const signature = (elements, state, files) =>
  elements
    .map((e) => [e.id, e.version, e.isDeleted, e.type === 'image' ? e.fileId : ''].join(':'))
    .join('|') +
  '#' +
  Object.entries(files)
    .map(([id, f]) => id + ':' + (f.dataURL?.length || 0))
    .join('|') +
  '#' +
  state.viewBackgroundColor +
  '#' +
  state.gridSize;

export async function mount(root, context, callbacks = {}) {
  let api,
    view,
    setMessage,
    setProblem,
    setShortcutHelp,
    disposed = false,
    busy = false,
    lastHash = '',
    applying = false,
    pendingFocus = false;
  const apiRef = { current: null },
    rootRef = { current: root },
    widgetsRef = React.createRef();
  let layoutFrame = null,
    layoutObserver;
  function refreshCoordinates() {
    if (!api || disposed) return;
    const element = root.querySelector('.excalidraw');
    if (!element) return;
    const rect = element.getBoundingClientRect(),
      state = api.getAppState();
    if (!rect.width || !rect.height) return;
    if (
      Math.abs(rect.top - state.offsetTop) > 0.25 ||
      Math.abs(rect.left - state.offsetLeft) > 0.25 ||
      Math.abs(rect.width - state.width) > 0.25 ||
      Math.abs(rect.height - state.height) > 0.25
    )
      flushSync(() => api.refresh());
  }
  function scheduleCoordinates() {
    if (layoutFrame !== null || disposed) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      refreshCoordinates();
    });
  }
  const session = new CanvasSession({
    context,
    request,
    drafts: { read: draftRead, put: draftPut, delete: draftDelete, purge: draftPurge },
    onImages: callbacks.onImages,
    onStatus: (kind, e) => {
      if (disposed) return;
      if (kind === 'purged') {
        callbacks.onPurged?.();
        return;
      }
      const messages = {
        saved: '笔记已保存到 DSH',
        waiting: '正在保存笔记…',
        saving: '正在同步画布…',
        recovered: '已恢复本机笔迹草稿',
        conflict: '画布已在另一处更新，你的笔迹已保留',
        error: '尚未同步，笔迹保存在本机',
        'local-error': '本机草稿保存失败，请保持面板打开',
        'waiting-image': '图片准备完成后自动保存',
      };
      callbacks.onSaveStatus?.(kind, messages[kind] || '');
      setMessage?.(messages[kind] || '');
      if (['conflict', 'error', 'local-error', 'waiting-image'].includes(kind))
        setProblem?.({ kind, message: e?.message || messages[kind] });
      else if (kind === 'saved') setProblem?.(null);
    },
  });
  const initial = await session.load();
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));
  function fit(target = api?.getSceneElements()) {
    const elements = (Array.isArray(target) ? target : [target]).filter((e) => e && !e.isDeleted),
      stage = root.querySelector('.canvas-engine');
    if (!elements.length || !stage) return;
    const [x1, y1, x2, y2] = getCommonBounds(elements),
      width = stage.clientWidth,
      height = stage.clientHeight,
      left = width >= 740 ? 230 : 24,
      right = 24,
      top = 85,
      bottom = 85;
    if (width < 1 || height < 1) return;
    const zoom = Math.max(
      0.1,
      Math.min(
        1,
        (width - left - right) / Math.max(1, x2 - x1),
        (height - top - bottom) / Math.max(1, y2 - y1),
      ) * 0.9,
    );
    api.refresh();
    api.updateScene({
      appState: {
        zoom: { value: zoom },
        scrollX: (left + (width - left - right) / 2) / zoom - (x1 + x2) / 2,
        scrollY: (top + (height - top - bottom) / 2) / zoom - (y1 + y2) / 2,
      },
    });
  }
  function apply(scene, focusId) {
    applying = true;
    try {
      const elements = restoreElements(scene.elements, null);
      api.addFiles(Object.values(scene.files));
      api.updateScene({
        elements,
        appState: {
          ...cleanState(scene.appState),
          ...(focusId ? { selectedElementIds: { [focusId]: true } } : {}),
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      lastHash = signature(elements, api.getAppState(), api.getFiles());
      if (focusId) {
        const target = elements.find((e) => e.id === focusId && !e.isDeleted);
        if (target) {
          pendingFocus = true;
          api.setActiveTool({ type: 'selection' });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (!disposed) fit(target);
            }),
          );
        }
      }
    } finally {
      applying = false;
    }
  }
  function changed(elements, state, files) {
    if (applying || disposed || busy) return;
    files = { ...session.scene.files, ...files, ...api?.getFiles() };
    const hash = signature(elements, state, files);
    if (!lastHash) {
      lastHash = hash;
      return;
    }
    if (hash === lastHash) return;
    lastHash = hash;
    session.change({
      elements: elements.map((e) => ({ ...e })),
      appState: cleanState(state),
      files: { ...files },
    });
  }
  async function flushCanvas() {
    if (api && !disposed && !applying) {
      const elements = api.getSceneElementsIncludingDeleted(),
        state = api.getAppState(),
        files = { ...session.scene.files, ...api.getFiles() };
      if (
        signature(elements, state, files) !==
        signature(session.scene.elements, session.scene.appState, session.scene.files)
      )
        session.change({ elements: elements.map((e) => ({ ...e })), appState: cleanState(state), files });
    }
    return session.flush();
  }
  const action = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      setProblem({ kind: e.code === 'CANVAS_CONFLICT' ? 'conflict' : 'error', message: e.message });
    }
  };
  function download() {
    const blob = new Blob(
        [JSON.stringify({ type: 'excalidraw', version: 2, source: 'studyboard', ...session.scene })],
        { type: 'application/json' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = context.title + '.excalidraw';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function Canvas() {
    const [shortcutsOpen, updateShortcuts] = useState(false);
    setShortcutHelp = updateShortcuts;
    const [message, updateMessage] = useState(
        session.conflict
          ? '画布已在另一处更新，你的笔迹已保留'
          : session.dirty
            ? '已恢复本机笔迹草稿'
            : '笔记已保存到 DSH',
      ),
      [problem, updateProblem] = useState(
        session.conflict ? { kind: 'conflict', message: '请另存你的笔迹，或载入最新画布。' } : null,
      );
    setMessage = updateMessage;
    setProblem = updateProblem;
    return (
      <>
        <div className="canvas-status">
          <span role="status" title={message}>
            {message}
          </span>
          <div>
            <button onClick={() => widgetsRef.current?.openMenu()}>学习控件</button>
            <button title="占满插件面板（Option/Alt + Shift + F）" onClick={() => callbacks.onFocus?.(true)}>
              专注画布
            </button>
            <button title="画布快捷键（?）" onClick={() => updateShortcuts(true)}>
              快捷键
            </button>
            <button title="立即保存（Option/Alt + S）" onClick={action(() => flushCanvas())}>
              保存
            </button>
          </div>
        </div>
        {problem && (
          <div className="canvas-problem" role="alert">
            <p>{problem.message}</p>
            {problem.kind === 'conflict' ? (
              <>
                <button
                  onClick={action(async () => {
                    const copy = await session.saveCopy();
                    await callbacks.onFork?.(copy);
                  })}
                >
                  另存我的画布
                </button>
                <button onClick={action(async () => apply(await session.useRemote()))}>载入最新画布</button>
              </>
            ) : (
              <button onClick={action(() => flushCanvas())}>重试同步</button>
            )}
            <button onClick={download}>下载画布草稿</button>
          </div>
        )}
        <CanvasTools apiRef={apiRef} rootRef={rootRef} onFit={() => fit()}>
          <CanvasComments
            key={context.id}
            apiRef={apiRef}
            rootRef={rootRef}
            noteId={context.id}
            execute={async (r) => (await request('/module', r)).value}
            flush={flushCanvas}
          />
          <ImageText
            apiRef={apiRef}
            rootRef={rootRef}
            noteId={context.id}
            execute={async (r) => (await request('/module', r)).value}
            flush={flushCanvas}
          />
        </CanvasTools>
        <div className="canvas-engine">
          <Excalidraw
            excalidrawAPI={(value) => {
              api = value;
              readyResolve();
              apiRef.current = value;
            }}
            initialData={{
              ...initial,
              appState: {
                ...initial.appState,
                currentItemFontFamily: 2,
                activeTool: {
                  type: initial.elements.some((e) => e.type === 'image' && !e.isDeleted)
                    ? 'selection'
                    : 'freedraw',
                  customType: null,
                  locked: false,
                  lastActiveTool: null,
                },
              },
              scrollToContent: true,
            }}
            onChange={changed}
            langCode="zh-CN"
            name={context.title}
            handleKeyboardGlobally={false}
            UIOptions={{
              tools: { laser: false },
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                saveAsImage: false,
                toggleTheme: false,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
            </MainMenu>
          </Excalidraw>
        </div>
        <LearningWidgets ref={widgetsRef} apiRef={apiRef} rootRef={rootRef} />

        {shortcutsOpen && <CanvasShortcutHelp root={root} capture onClose={() => updateShortcuts(false)} />}
      </>
    );
  }
  view = createRoot(root);
  view.render(<Canvas />);
  await ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  api.refresh();
  fit(initial.elements);
  layoutObserver = new ResizeObserver(scheduleCoordinates);
  for (const element of new Set(
    [
      root,
      root.parentElement,
      root.querySelector('.canvas-engine'),
      document.querySelector('.workspace-tools'),
    ].filter(Boolean),
  ))
    layoutObserver.observe(element);
  window.addEventListener('scroll', scheduleCoordinates, true);
  window.addEventListener('resize', scheduleCoordinates);
  // Native capture runs before Excalidraw handles the pointer, including when a
  // preceding status message changed layout during this same event loop.
  root.addEventListener('pointerdown', refreshCoordinates, true);
  const unbindShortcuts = bindCanvasShortcuts(root, {
    getApi: () => api,
    onSave: () => flushCanvas(),
    onCapture: (mode) => callbacks.onCapture?.(mode),
    onFit: fit,
    onWidget: (kind) => widgetsRef.current?.open(kind),
    onHelp: () => setShortcutHelp(true),
    onError: (e) =>
      setProblem({ kind: e.code === 'CANVAS_CONFLICT' ? 'conflict' : 'error', message: e.message }),
  });
  if (session.dirty && !session.conflict && !session.blocked) flushCanvas().catch(() => {});
  const timer = setInterval(() => {
    if (session.dirty && !session.conflict && !session.blocked) flushCanvas().catch(() => {});
  }, 10000);
  return {
    id: context.id,
    flush: () => flushCanvas(),
    persist: () => session.persist(),
    get dirty() {
      return session.dirty;
    },
    get revision() {
      return session.revision;
    },
    setBusy(value) {
      busy = value;
      root.inert = value;
      root.classList.toggle('is-busy', value);
      if (!value && pendingFocus) {
        pendingFocus = false;
        focusCanvas(root);
      }
    },
    async reload(focusId) {
      const scene = await session.reload();
      if (scene && !disposed) apply(scene, focusId);
    },
    focus(id) {
      const element = api.getSceneElements().find((e) => e.id === id);
      if (element) {
        api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
        fit(element);
        api.setActiveTool({ type: 'selection' });
        focusCanvas(root);
      }
    },
    viewport() {
      const r = root.querySelector('.excalidraw')?.getBoundingClientRect(),
        s = api.getAppState();
      return r && r.width && r.height
        ? {
            x: r.width / (2 * s.zoom.value) - s.scrollX,
            y: r.height / (2 * s.zoom.value) - s.scrollY,
            zoom: s.zoom.value,
          }
        : null;
    },
    resizeViewport(view) {
      if (disposed) return;
      refreshCoordinates();
      const r = root.querySelector('.excalidraw')?.getBoundingClientRect();
      if (view && r?.width && r?.height)
        api.updateScene({
          appState: {
            zoom: { value: view.zoom },
            scrollX: r.width / (2 * view.zoom) - view.x,
            scrollY: r.height / (2 * view.zoom) - view.y,
          },
        });
      refreshCoordinates();
    },
    focusCanvas() {
      if (!disposed) focusCanvas(root);
    },
    showShortcuts() {
      setShortcutHelp(true);
    },
    showLearningTools() {
      widgetsRef.current?.openMenu();
    },
    openImageNote(id) {
      widgetsRef.current?.editImage(id);
    },
    isInteracting() {
      const s = api.getAppState();
      return !!(
        s.editingTextElement ||
        s.openDialog ||
        s.openPopup ||
        s.newElement ||
        s.multiElement ||
        s.editingLinearElement ||
        root.dataset.learningPlacement
      );
    },
    refresh: refreshCoordinates,
    async dispose({ discard = false } = {}) {
      disposed = true;
      clearInterval(timer);
      unbindShortcuts();
      layoutObserver.disconnect();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      window.removeEventListener('scroll', scheduleCoordinates, true);
      window.removeEventListener('resize', scheduleCoordinates);
      root.removeEventListener('pointerdown', refreshCoordinates, true);
      view.unmount();
      if (discard) await session.discard();
      else await session.dispose();
    },
  };
}
window.StudyboardCanvas = { mount };
