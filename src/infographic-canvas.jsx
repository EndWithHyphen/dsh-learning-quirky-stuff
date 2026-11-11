import React, { useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import { cleanState } from './export.js';
import { exportInfographic, visibleSource } from './infographic-render.js';
import { draftRead, draftPut, draftDelete } from './drafts.js';
import { sameSceneContent, withKnownFiles, missingImageFiles } from './scene-sync.js';
import { bindCanvasShortcuts } from './canvas-shortcuts.js';
import CanvasTools from './canvas-tools.jsx';
import CanvasComments from './canvas-comments.jsx';
import { useLearning } from './features/context.jsx';

export default function InfographicCanvas({
  entry,
  initialScene,
  saved,
  api,
  onClose,
  onSaved,
  onError,
  sourcesInitially = false,
}) {
  const learning = useLearning();
  const dialog = useRef(),
    engine = useRef(),
    surface = useRef(),
    scene = useRef(initialScene),
    revision = useRef(saved?.revision || 0),
    sequence = useRef(0),
    pending = useRef(),
    flight = useRef(),
    timer = useRef(),
    dirty = useRef(false),
    alive = useRef(true);
  const key = entry.noteId + ':infographic:' + entry.summaryId + ':' + entry.id;
  const [initial, setInitial] = useState(null),
    [status, setStatus] = useState('正在打开'),
    [error, setError] = useState(''),
    [showSources, setShowSources] = useState(sourcesInitially),
    [picked, setPicked] = useState(null),
    [sourceImages, setSourceImages] = useState({}),
    [closing, setClosing] = useState(false);
  useEffect(() => {
    dialog.current.showModal();
    alive.current = true;
    (async () => {
      const local = await draftRead(key).catch(() => null);
      const useLocal = local?.scene && !sameSceneContent(local.scene, initialScene);
      if (useLocal) {
        scene.current = local.scene;
        revision.current =
          local.pendingId && local.pendingId === saved?.lastSave?.requestId
            ? saved.revision
            : local.baseRevision;
        dirty.current = true;
        if (revision.current !== (saved?.revision || 0))
          setError('另一窗口已有新版本。当前显示本机草稿，请先下载保留。');
      }
      if (alive.current) {
        setInitial({
          ...scene.current,
          appState: { ...scene.current.appState, activeTool: { type: 'selection' } },
          scrollToContent: true,
        });
        setStatus(useLocal ? '已恢复本机草稿' : saved ? '已保存' : '可编辑');
      }
    })().catch((e) => setError(e.message));
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      if (dirty.current) flush().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!initial || !surface.current) return;
    return bindCanvasShortcuts(surface.current, {
      getApi: () => engine.current,
      onSave: flush,
      onExport: () => exportInfographic(snapshot(), entry.figure.title, 'pdf'),
      onFit: fit,
      onError,
    });
  }, [!!initial]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(fit));
    return () => cancelAnimationFrame(frame);
  }, [showSources, !!initial]);
  useEffect(() => {
    if (!showSources) return;
    let stopped = false;
    Promise.all(
      Object.entries(entry.assets || {}).map(async ([id, asset]) => [
        id,
        (await visibleSource(asset)).dataURL,
      ]),
    )
      .then((values) => {
        if (!stopped) setSourceImages(Object.fromEntries(values));
      })
      .catch((e) => setError(e.message));
    return () => {
      stopped = true;
    };
  }, [showSources]);
  function snapshot() {
    return engine.current
      ? withKnownFiles(
          {
            elements: engine.current.getSceneElementsIncludingDeleted(),
            files: engine.current.getFiles(),
            appState: cleanState(engine.current.getAppState()),
          },
          scene.current,
        )
      : scene.current;
  }
  function storeDraft() {
    return draftPut(key, {
      scene: scene.current,
      baseRevision: revision.current,
      pendingId: pending.current?.request.requestId || '',
      updatedAt: new Date().toISOString(),
    });
  }
  async function flush() {
    if (flight.current) return flight.current;
    flight.current = (async () => {
      while (dirty.current) {
        if (!pending.current) {
          const data = structuredClone(snapshot());
          if (missingImageFiles(data).length) throw new Error('图片还在载入，草稿已保留，请稍后保存');
          scene.current = data;
          pending.current = {
            at: sequence.current,
            request: {
              action: 'infographics.saveCanvas',
              noteId: entry.noteId,
              summaryId: entry.summaryId,
              id: entry.id,
              scene: data,
              baseRevision: revision.current,
              requestId: crypto.randomUUID(),
            },
          };
        }
        await storeDraft();
        const sending = pending.current,
          result = await api('execute', sending.request);
        revision.current = result.revision;
        pending.current = null;
        if (sequence.current === sending.at) {
          dirty.current = false;
          await draftDelete(key);
        } else await storeDraft();
      }
      if (alive.current) {
        setStatus('已保存');
        setError('');
      }
    })()
      .catch((e) => {
        if (alive.current) {
          setStatus('草稿保存在本机');
          setError(e.message);
        }
        throw e;
      })
      .finally(() => {
        flight.current = null;
      });
    return flight.current;
  }
  function change(elements, appState, files) {
    if (!initial) return;
    const selected = elements.find((e) => appState.selectedElementIds[e.id] && e.customData?.infographic)
      ?.customData.infographic;
    setPicked((old) => (JSON.stringify(old) === JSON.stringify(selected || null) ? old : selected || null));
    const next = withKnownFiles({ elements, files, appState: cleanState(appState) }, scene.current);
    if (sameSceneContent(next, scene.current)) return;
    scene.current = next;
    sequence.current++;
    dirty.current = true;
    setStatus('正在保存…');
    clearTimeout(timer.current);
    storeDraft().catch((e) => setError('本机草稿保存失败：' + e.message));
    timer.current = setTimeout(() => flush().catch(() => {}), 700);
  }
  function fit() {
    if (engine.current)
      engine.current.scrollToContent(engine.current.getSceneElements(), {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        maxZoom: 1,
      });
  }
  async function close() {
    setClosing(true);
    try {
      await flush();
      await onSaved?.();
      onClose();
    } catch {
    } finally {
      setClosing(false);
    }
  }
  const references = picked?.sourceIds?.length
    ? (entry.sources || []).filter((s) => picked.sourceIds.includes(s.id))
    : entry.sources || [];
  return (
    <dialog
      className="sb-info-dialog"
      ref={dialog}
      aria-label={'编辑信息图：' + entry.figure.title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="sb-info-dialog-header">
        <div>
          <span className="sb-eyebrow">可编辑信息图</span>
          <h2>{entry.figure.title}</h2>
        </div>
        <div>
          <span role="status">{status}</span>
          <button className="sb-button" onClick={() => setShowSources((v) => !v)}>
            来源
          </button>
          <select
            aria-label="导出信息图"
            value=""
            onChange={(event) =>
              exportInfographic(snapshot(), entry.figure.title, event.target.value).catch(onError)
            }
          >
            <option value="" disabled>
              导出…
            </option>
            <option value="png">PNG 图片</option>
            <option value="svg">SVG 矢量图</option>
            <option value="pdf">PDF</option>
            <option value="excalidraw">可编辑画布</option>
          </select>
          <button className="sb-button" disabled={closing} onClick={close}>
            保存并关闭
          </button>
        </div>
      </header>
      {error && (
        <div className="sb-info-error" role="alert">
          <span>{error}</span>
          <button className="sb-button" onClick={() => flush().catch(() => {})}>
            重试保存
          </button>
          <button
            className="sb-button"
            onClick={() => exportInfographic(snapshot(), entry.figure.title, 'excalidraw').catch(onError)}
          >
            下载草稿
          </button>
          <button
            className="sb-button"
            onClick={async () => {
              try {
                await storeDraft();
                onClose();
              } catch (e) {
                onError(e);
              }
            }}
          >
            保留草稿并关闭
          </button>
        </div>
      )}
      <div className="sb-info-edit-workspace">
        <div className="sb-info-drawing study-canvas-surface" ref={surface}>
          <CanvasTools apiRef={engine} rootRef={surface} onFit={fit}>
            <CanvasComments
              key={entry.id}
              apiRef={engine}
              rootRef={surface}
              noteId={entry.noteId}
              canvas={{ kind: 'infographic', id: entry.id, summaryId: entry.summaryId }}
              execute={(r) => api('execute', r)}
              flush={async () => {
                if (!revision.current) dirty.current = true;
                await flush();
              }}
            />
          </CanvasTools>
          <div className="sb-info-engine">
            {initial && (
              <Excalidraw
                langCode="zh-CN"
                theme="light"
                initialData={initial}
                excalidrawAPI={(value) => {
                  if (engine.current === value) return;
                  engine.current = value;
                  requestAnimationFrame(fit);
                }}
                onChange={change}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    export: false,
                    saveAsImage: false,
                    toggleTheme: false,
                  },
                }}
              />
            )}
          </div>
        </div>
        {showSources && (
          <aside className="sb-info-evidence">
            <header>
              <strong>图文来源</strong>
              <button className="sb-icon" onClick={() => setShowSources(false)} aria-label="关闭信息图来源">
                ×
              </button>
            </header>
            {picked && (
              <p>
                {picked.origin === 'inference' ? '由材料进一步推断' : '按材料整理'} ·{' '}
                {picked.label?.slice(0, 80)}
              </p>
            )}
            <p className="sb-muted">
              以下保留生成时的依据。材料观点与 AI 整理均可能有局限；修改文字后请检查来源是否仍然支持。
            </p>
            {references.map((source) => (
              <article key={source.id}>
                <h4>
                  {source.id} · {source.title}
                </h4>
                <small>
                  {source.kind === 'summary'
                    ? '已有 AI 总结'
                    : source.kind === 'image'
                      ? '原始截图'
                      : '笔记文字'}
                </small>
                {sourceImages[source.id] && <img src={sourceImages[source.id]} alt={source.title} />}
                {source.text && <p>{source.text}</p>}
                {source.pdfSource && (
                  <button
                    className="sb-button"
                    onClick={async () => {
                      try {
                        await flush();
                        onClose();
                        learning.navigation.current.openSource?.({
                          boardId: source.pdfSource.noteId || entry.noteId,
                          locator: { pdf: source.pdfSource },
                        });
                      } catch (e) {
                        onError(e);
                      }
                    }}
                  >
                    打开 PDF 第 {source.pdfSource.page} 页 ↗
                  </button>
                )}
              </article>
            ))}
            {!references.length && <p>来源为这篇笔记的本次 AI 总结。</p>}
            <details>
              <summary>为什么采用这种表达</summary>
              <p>{entry.figure.rationale}</p>
            </details>
          </aside>
        )}
      </div>
      <footer>双击文字修改，拖动对象调整排版。⌘Z 撤销。改动自动保存。</footer>
    </dialog>
  );
}
