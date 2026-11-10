import React, { useEffect, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements, serializeAsJSON } from '@excalidraw/excalidraw';
import { studySketches, STUDY_ORIGIN_NAMES } from './system-study-layout.js';
import { cleanState, download, filename, pdfBlob } from './export.js';
import { sameSceneContent, withKnownFiles, missingImageFiles } from './scene-sync.js';
import { draftRead, draftPut, draftDelete } from './drafts.js';
import CanvasTools from './canvas-tools.jsx';
import CanvasComments from './canvas-comments.jsx';
import { bindCanvasShortcuts } from './canvas-shortcuts.js';
import { Action, Evidence, ErrorNotice } from './features/shared.jsx';

export default function SystemStudyCanvas({ report, saved, api, onError, onReload }) {
  const ref = useRef(),
    root = useRef(),
    scene = useRef(),
    revision = useRef(saved?.revision || 0),
    dirty = useRef(false),
    sequence = useRef(0),
    timer = useRef(),
    flight = useRef(),
    pending = useRef(),
    alive = useRef(true),
    key = report.key + ':system-study:' + report.id,
    selection = useRef('');
  const [initial, setInitial] = useState(null),
    [saveState, setSaveState] = useState('加载画布'),
    [error, setError] = useState(''),
    [picked, setPicked] = useState(null),
    [full, setFull] = useState(false),
    [sketch] = useState(() => {
      const context = document.createElement('canvas').getContext('2d');
      return studySketches(report, (text, size) => {
        context.font = `${size}px Helvetica, Arial, sans-serif`;
        return context.measureText(text).width;
      });
    });
  useEffect(() => {
    alive.current = true;
    (async () => {
      const local = await draftRead(key).catch(() => null);
      const elements = saved?.scene ? null : convertToExcalidrawElements(sketch.shapes);
      if (elements) {
        const byId = new Map(elements.map((e) => [e.id, e]));
        for (const e of elements) if (e.containerId) e.customData = byId.get(e.containerId)?.customData;
      }
      const base = saved?.scene || { elements, files: {}, appState: { viewBackgroundColor: '#fffdf7' } };
      const useDraft = local?.scene && !sameSceneContent(local.scene, base);
      scene.current = useDraft ? local.scene : base;
      if (useDraft)
        revision.current =
          local.pendingId && local.pendingId === saved?.lastSave?.requestId
            ? saved.revision
            : local.baseRevision;
      dirty.current = useDraft || !saved;
      if (alive.current) {
        setInitial({
          ...scene.current,
          appState: { ...scene.current.appState, activeTool: { type: 'selection' } },
        });
        if (useDraft && revision.current !== (saved?.revision || 0))
          setError('另一窗口已有新版本。当前草稿已恢复，可下载后载入已保存版本。');
        setSaveState(useDraft ? '已恢复本机草稿' : saved ? '已保存' : '待保存');
      }
    })().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      flush().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!root.current || !initial) return;
    return bindCanvasShortcuts(root.current, {
      getApi: () => ref.current,
      onSave: flush,
      onExport: exportPdf,
      onFit: fit,
      onError: (e) => setError(e.message),
    });
  }, [!!initial]);
  function snapshot() {
    if (!ref.current) return scene.current;
    return withKnownFiles(
      {
        elements: ref.current.getSceneElementsIncludingDeleted(),
        appState: cleanState(ref.current.getAppState()),
        files: ref.current.getFiles(),
      },
      scene.current,
    );
  }
  function storeDraft() {
    return scene.current
      ? draftPut(key, {
          scene: scene.current,
          baseRevision: revision.current,
          pendingId: pending.current?.request.requestId || '',
          updatedAt: new Date().toISOString(),
        })
      : Promise.resolve();
  }
  async function flush() {
    if (flight.current) return flight.current;
    flight.current = (async () => {
      while (dirty.current && scene.current) {
        if (!pending.current) {
          const data = structuredClone(snapshot());
          if (missingImageFiles(data).length) throw new Error('图片仍在载入，草稿已保留，请稍后保存');
          scene.current = data;
          pending.current = {
            at: sequence.current,
            request: {
              action: 'systemStudy.saveCanvas',
              id: report.id,
              baseRevision: revision.current,
              scene: data,
              requestId: crypto.randomUUID(),
            },
          };
        }
        await storeDraft();
        const sending = pending.current,
          next = await api('execute', sending.request);
        revision.current = next.revision;
        pending.current = null;
        if (sequence.current === sending.at) {
          dirty.current = false;
          await draftDelete(key);
        } else await storeDraft();
      }
      if (alive.current) {
        setSaveState('已保存');
        setError('');
      }
    })()
      .catch((e) => {
        if (alive.current) {
          setSaveState('草稿保存在本机');
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
    const next = withKnownFiles({ elements, files, appState: cleanState(appState) }, scene.current);
    const selected = elements.find(
      (e) => appState.selectedElementIds[e.id] && e.customData?.systemStudy?.itemId,
    );
    const id = selected?.customData.systemStudy.itemId || '';
    if (selection.current !== id) {
      selection.current = id;
      setPicked(id ? sketch.entries[id] : null);
    }
    if (!scene.current || sameSceneContent(next, scene.current)) return;
    scene.current = next;
    dirty.current = true;
    sequence.current++;
    setSaveState('正在保存…');
    clearTimeout(timer.current);
    storeDraft().catch((e) => setError('本机草稿保存失败：' + e.message));
    timer.current = setTimeout(() => flush().catch(() => {}), 800);
  }
  function fit(viewId = null) {
    if (!ref.current) return;
    const elements = ref.current
      .getSceneElements()
      .filter((e) => !viewId || e.customData?.systemStudy?.viewId === viewId);
    if (elements.length)
      ref.current.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.84, maxZoom: 1 });
  }
  function exportScene() {
    const data = snapshot();
    if (!data) return;
    download(
      new Blob([serializeAsJSON(data.elements, data.appState, data.files, 'local')], {
        type: 'application/json',
      }),
      filename(report.value.title, 'excalidraw'),
    );
  }
  async function exportPdf() {
    try {
      download(
        await pdfBlob({ title: report.value.title }, snapshot(), 'pages'),
        filename(report.value.title, 'pdf'),
      );
    } catch (e) {
      onError(e);
    }
  }
  async function reload() {
    if (!confirm('载入已保存版本会替换当前本机草稿。请先下载需要保留的修改。')) return;
    clearTimeout(timer.current);
    if (flight.current) await flight.current.catch(() => {});
    dirty.current = false;
    pending.current = null;
    await draftDelete(key);
    onReload();
  }
  const period = picked?.period;
  return (
    <section className={'sb-system-canvas ' + (full ? 'is-full' : '')}>
      <div className="sb-system-canvas-actions">
        <div className="sb-system-views">
          {sketch.views.map((view) => (
            <Action key={view.id} onClick={() => fit(view.id)}>
              {view.title}
            </Action>
          ))}
        </div>
        <div>
          <span role="status">{saveState}</span>
          <Action onClick={() => flush().catch(() => {})}>保存</Action>
          <Action onClick={exportScene}>下载画布</Action>
          <Action onClick={exportPdf}>PDF</Action>
          <Action onClick={() => setFull((v) => !v)}>{full ? '退出专注' : '专注画布'}</Action>
        </div>
      </div>
      <ErrorNotice error={error} />
      {error && <Action onClick={reload}>载入已保存版本</Action>}
      <div className="sb-system-workspace">
        <div className="sb-system-drawing study-canvas-surface" ref={root}>
          <CanvasTools apiRef={ref} rootRef={root} onFit={() => fit()}>
            <CanvasComments
              key={report.id}
              apiRef={ref}
              rootRef={root}
              noteId={report.key}
              canvas={{ kind: 'study', id: report.id }}
              execute={(r) => api('execute', r)}
              flush={flush}
            />
          </CanvasTools>
          <div className="sb-system-engine">
            {initial && (
              <Excalidraw
                langCode="zh-CN"
                initialData={initial}
                theme="light"
                onChange={change}
                excalidrawAPI={(value) => {
                  if (ref.current === value) return;
                  ref.current = value;
                  setTimeout(() => {
                    fit(sketch.views[0]?.id);
                    if (dirty.current) flush().catch(() => {});
                  }, 100);
                }}
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
        {picked && (
          <aside className="sb-system-evidence">
            <header>
              <strong>{picked.title}</strong>
              <button className="sb-icon" aria-label="关闭论证依据" onClick={() => setPicked(null)}>
                ×
              </button>
            </header>
            <span className="sb-system-origin">{STUDY_ORIGIN_NAMES[picked.origin]}</span>
            <p className="sb-muted">以下是生成时的依据。修改论点后，请重新检查引用是否仍然适用。</p>
            {period && (
              <>
                <p>
                  知识截止：{period.cutoffYear} 年 ·{' '}
                  {period.dateStatus === 'dated' ? '有标注发布日期的材料' : '回溯重建，部分资料日期未核实'}
                </p>
                <h4>当时的问题</h4>
                <p>{period.problem}</p>
                <h4>当时可用的知识</h4>
                <p>{period.availableKnowledge}</p>
                <h4>当时的解释</h4>
                <p>{period.explanation}</p>
                <h4>当时未知</h4>
                <p>{period.unknown}</p>
                <h4>后来如何修正</h4>
                <p>{period.laterRevision}</p>
              </>
            )}
            <Evidence sources={picked.evidence || []} />
            {period && period.laterEvidence.length > 0 && (
              <>
                <h4>后来的资料</h4>
                <Evidence sources={period.laterEvidence} />
              </>
            )}
            {picked.origin === 'background' && (
              <p>这段扩展尚未经过外部资料核实，可把它作为进一步研究的线索。</p>
            )}
          </aside>
        )}
      </div>
      <p className="sb-system-canvas-hint">
        双击卡片编辑文字，拖动节点调整论证；单击节点或连线查看生成时的依据。可继续手写、画图和粘贴图片。
      </p>
    </section>
  );
}
