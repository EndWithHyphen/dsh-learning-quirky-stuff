import React, { useEffect, useRef, useState, useMemo, useImperativeHandle } from 'react';
import CanvasComments from '../canvas-comments.jsx';
import { commentHash } from '../comment-adapter.js';
import { commentSourceContent } from '../../shared/canvas-comments.js';
import { pdfReference, pdfCommentElement, pdfSelectionText, normalizePdfText } from '../../shared/pdf.js';
import { draftRead, draftPut, draftDelete } from '../drafts.js';
import { download, filename } from '../export.js';
import { PdfAnnotationSession } from './session.js';
import { PdfFrameCache } from './frame-cache.js';
import { openPdf, TextLayer, viewportRect, pdfRect, renderPdfRegion } from './engine.js';

const empty = () => {};
const PdfReader = React.forwardRef(function PdfReader(
  {
    noteId,
    document: documentInfo,
    notebook,
    execute,
    onExtract,
    onClose,
    onManage,
    focus,
    onMeta,
    onBusy = empty,
  },
  ref,
) {
  const root = useRef(),
    scroller = useRef(),
    pageBox = useRef(),
    canvas = useRef(),
    textLayer = useRef(),
    engine = useRef(),
    viewport = useRef(),
    pageData = useRef(),
    session = useRef(),
    discussions = useRef(),
    listeners = useRef(new Set()),
    state = useRef(),
    alive = useRef(true),
    epoch = useRef(0),
    gesture = useRef(),
    positionTimer = useRef(),
    searchEpoch = useRef(0),
    editorLoaded = useRef(false),
    frames = useRef(null);
  if (!frames.current) frames.current = new PdfFrameCache();
  const [page, setPage] = useState(focus?.page || notebook.positions?.[documentInfo.id] || 1),
    [count, setCount] = useState(documentInfo.pageCount || 0),
    [zoom, setZoom] = useState('fit'),
    [rotation, setRotation] = useState(0),
    [width, setWidth] = useState(500),
    [size, setSize] = useState({ width: 500, height: 700 }),
    [loaded, setLoaded] = useState(false),
    [rendering, setRendering] = useState(false),
    [renderKey, setRenderKey] = useState(''),
    [error, setError] = useState(''),
    [mode, setMode] = useState('text'),
    [selection, setSelection] = useState(null),
    [annotations, setAnnotations] = useState([]),
    [pending, setPending] = useState(0),
    [saveError, setSaveError] = useState(''),
    [draftStroke, setDraftStroke] = useState(null),
    [editor, setEditor] = useState(null),
    [showAnnotations, setShowAnnotations] = useState(false),
    [showOutline, setShowOutline] = useState(false),
    [outline, setOutline] = useState([]),
    [query, setQuery] = useState(''),
    [results, setResults] = useState(null),
    [searching, setSearching] = useState(false),
    [scanned, setScanned] = useState(0),
    [password, setPassword] = useState(null),
    [passwordValue, setPasswordValue] = useState(''),
    [recognizing, setRecognizing] = useState(false),
    [notice, setNotice] = useState(''),
    [removed, setRemoved] = useState(null),
    [busy, setBusy] = useState(false),
    [canDiscuss, setCanDiscuss] = useState(false),
    [ocrCapability, setOcrCapability] = useState(null);
  state.current = { page, annotations, selection, mode };
  const notify = () => {
    for (const fn of listeners.current) fn();
  };
  const linkedRequest = (r) => execute({ ...r, noteId, documentId: documentInfo.id });
  useEffect(() => {
    onBusy(pending > 0 || busy);
  }, [pending, busy]);
  const annotationRequest = (a) => ({ action: 'pdf.annotate', noteId, documentId: documentInfo.id, ...a });
  const editorKey = noteId + ':pdf-editor:' + documentInfo.id;
  useEffect(() => {
    let disposed = false;
    draftRead(editorKey)
      .then((saved) => {
        if (!disposed) {
          if (saved?.editor) setEditor(saved.editor);
          editorLoaded.current = true;
        }
      })
      .catch((e) => {
        if (!disposed) setError('批注草稿读取失败：' + e.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!editorLoaded.current) return;
    const write = editor ? draftPut(editorKey, { editor }) : draftDelete(editorKey);
    write.catch((e) => {
      if (alive.current) setError('批注草稿保存失败：' + e.message);
    });
  }, [editor]);
  function editAnnotation(value) {
    setEditor({ ...value, id: value.id || crypto.randomUUID(), note: value.note || '' });
  }
  async function save(a) {
    if (!session.current) throw new Error('PDF 仍在载入');
    if ((a.quote?.length || 0) > 30000 || (a.note?.length || 0) > 6000)
      throw new Error('批注内容较长，请缩小选区或缩短备注');
    await session.current.add(annotationRequest(a));
    onMeta?.();
    return session.current.value().find((v) => v.id === a.id);
  }
  async function prepare() {
    const chosen = state.current.selection;
    if (!chosen) throw new Error('请先选中文字或框选区域');
    const current = state.current.annotations.find((a) => a.id === chosen.id && !a.deletedAt);
    if (current) {
      await session.current.flush();
      return [current.id];
    }
    const match = state.current.annotations.find(
      (a) =>
        !a.deletedAt &&
        a.page === chosen.page &&
        a.quote === chosen.quote &&
        JSON.stringify(a.rects) === JSON.stringify(chosen.rects),
    );
    const a =
      match || (await save({ ...chosen, id: chosen.id || crypto.randomUUID(), kind: 'reference', note: '' }));
    setSelection({ ...chosen, id: a.id });
    setShowAnnotations(false);
    return [a.id];
  }
  const adapter = useMemo(
    () => ({
      ready: () => !!engine.current && !!session.current,
      observe(fn) {
        listeners.current.add(fn);
        const el = scroller.current;
        el?.addEventListener('scroll', fn);
        return () => {
          listeners.current.delete(fn);
          el?.removeEventListener('scroll', fn);
        };
      },
      prepare: () => prepare(),
      state(threads) {
        if (!root.current || !pageBox.current || !viewport.current) return null;
        const host = root.current.getBoundingClientRect(),
          box = pageBox.current.getBoundingClientRect(),
          view = scroller.current.getBoundingClientRect(),
          vp = viewport.current,
          s = state.current;
        const pins = threads
          .filter((t) => !t.resolvedAt)
          .flatMap((t) => {
            const a = s.annotations.find(
              (a) => !a.deletedAt && a.page === s.page && t.elementIds.includes(a.id),
            );
            if (!a) return [];
            const rect = a.rects[0] || [
                a.points[0][0],
                a.points[0][1],
                a.points[0][0] + 4,
                a.points[0][1] + 4,
              ],
              b = viewportRect(vp, rect),
              x = box.left - host.left + b.x + b.width + 3,
              y = box.top - host.top + b.y;
            return x >= 0 && x < host.width - 25 && y >= view.top - host.top && y < host.height - 25
              ? [{ id: t.id, x, y }]
              : [];
          });
        return {
          selected: s.selection ? [s.selection.id || 'pending-pdf-selection'] : [],
          pins,
          bounds: { top: view.top - host.top + 8, height: Math.max(160, view.height - 16) },
        };
      },
      async capture(ids) {
        await session.current.flush();
        const selected = session.current.value().filter((a) => !a.deletedAt && ids.includes(a.id));
        if (selected.length !== ids.length) throw new Error('原文批注已删除');
        const a = selected[0],
          rendered = await renderPdfRegion(engine.current, a.page, a.rects, a.kind === 'ink' ? a.points : []);
        return {
          sourceHash: await commentHash(
            commentSourceContent(selected.map((a) => pdfCommentElement(documentInfo, a))),
          ),
          image: rendered.image,
        };
      },
      locate(thread) {
        const a = state.current.annotations.find((a) => thread.elementIds.includes(a.id));
        if (a) jump({ ...a });
      },
    }),
    [],
  );
  function jump(target) {
    target = state.current.annotations.find((a) => a.id === target.annotationId && !a.deletedAt) || target;
    setPage(target.page);
    setSelection(
      target.rects?.length || target.quote || target.id
        ? {
            page: target.page,
            rects: target.rects || [],
            quote: target.quote || '',
            id: target.id,
            kind: target.kind,
            points: target.points || [],
            selectionType: target.selectionType,
          }
        : null,
    );
    setShowOutline(false);
    setShowAnnotations(false);
    setResults(null);
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }
  useImperativeHandle(ref, () => ({ flush: () => session.current?.flush() || Promise.resolve(), jump }));
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const controller = new AbortController();
    execute({ action: 'features.get' })
      .then((s) => {
        if (!disposed) setCanDiscuss(s.features.canvasComments === true);
      })
      .catch(() => {});
    execute({ action: 'system.capabilities' })
      .then((s) => {
        if (!disposed) setOcrCapability(s.ocr);
      })
      .catch(() => {});
    const key = noteId + ':pdf:' + documentInfo.id;
    (async () => {
      const next = await new PdfAnnotationSession({
        execute: async (request) => {
          if (!engine.current) throw new Error('PDF 仍在载入');
          await (await engine.current.page(request.page)).index();
          return execute(request);
        },
        persist: (data) => draftPut(key, data),
        load: () => draftRead(key),
        onChange: (value) => {
          if (!disposed) {
            setAnnotations(value.annotations);
            setPending(value.pending);
            setSaveError(value.error);
          }
        },
      }).init((notebook.annotations || []).filter((a) => a.documentId === documentInfo.id));
      if (disposed) return;
      session.current = next;
      const value = await openPdf(
        execute,
        noteId,
        documentInfo,
        (update, reason) => {
          if (!disposed) setPassword({ update, reason });
        },
        (e) => {
          if (!disposed) setError(e.message);
        },
        controller.signal,
      );
      if (disposed) {
        await value.close();
        return;
      }
      engine.current = value;
      setCount(value.pdf.numPages);
      setPage((p) => Math.min(value.pdf.numPages, p));
      setLoaded(true);
      onMeta?.();
      if (next.queue.length) next.flush().catch(() => {});
      const outline = await value.pdf.getOutline();
      const flatten = (nodes, level = 0) =>
        nodes.flatMap((n) => [{ title: n.title, dest: n.dest, level }, ...flatten(n.items || [], level + 1)]);
      if (!disposed) setOutline(flatten(outline || []));
    })().catch((e) => {
      if (!disposed) setError(e.message);
    });
    const observer = new ResizeObserver(() => {
      const nextWidth = scroller.current?.clientWidth;
      if (nextWidth > 0) setWidth((previous) => (previous === nextWidth ? previous : nextWidth));
      notify();
    });
    if (scroller.current) observer.observe(scroller.current);
    return () => {
      disposed = true;
      controller.abort();
      alive.current = false;
      epoch.current++;
      searchEpoch.current++;
      clearTimeout(positionTimer.current);
      observer.disconnect();
      frames.current.clear();
      engine.current?.close();
      engine.current = null;
      onBusy(false);
    };
  }, []);
  useEffect(() => {
    notify();
  }, [annotations, selection, page, size]);
  useEffect(() => {
    if (focus?.page) jump(focus);
  }, [focus?.token]);
  useEffect(() => {
    if (!loaded || !engine.current) return;
    const version = ++epoch.current;
    let layer, preload;
    const currentEngine = engine.current;
    const frameAt = (number, current = false) => {
      const key = [number, zoom, rotation, width, window.devicePixelRatio || 1].join(':');
      return frames.current.get(
        key,
        async (signal) => {
          const data = await currentEngine.page(number);
          signal.throwIfAborted();
          const scale =
            zoom === 'fit'
              ? Math.max(
                  0.1,
                  (width - 33) /
                    data.page.getViewport({ scale: 1, rotation: (data.page.rotate + rotation) % 360 }).width,
                )
              : Number(zoom);
          const vp = data.page.getViewport({ scale, rotation: (data.page.rotate + rotation) % 360 });
          const ratio = Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(16_000_000 / (vp.width * vp.height)),
          );
          const raster = document.createElement('canvas');
          raster.width = Math.ceil(vp.width * ratio);
          raster.height = Math.ceil(vp.height * ratio);
          const task = data.page.render({
            canvasContext: raster.getContext('2d'),
            viewport: vp,
            transform: [ratio, 0, 0, ratio, 0, 0],
            background: '#ffffff',
          });
          const cancel = () => task.cancel();
          signal.addEventListener('abort', cancel, { once: true });
          try {
            await task.promise;
            signal.throwIfAborted();
            return { data, vp, raster, canvas: raster };
          } catch (error) {
            raster.width = raster.height = 0;
            throw error;
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        },
        current,
      );
    };
    setRendering(true);
    setError('');
    setDraftStroke(null);
    gesture.current = null;
    (async () => {
      const { data, vp, raster } = await frameAt(page, true);
      if (version !== epoch.current) return;
      data.index().catch((e) => {
        if (version === epoch.current && alive.current) setError('PDF 文字索引尚未保存：' + e.message);
      });
      viewport.current = vp;
      pageData.current = data;
      setSize({ width: vp.width, height: vp.height });
      canvas.current.width = raster.width;
      canvas.current.height = raster.height;
      canvas.current.getContext('2d').drawImage(raster, 0, 0);
      textLayer.current.replaceChildren();
      textLayer.current.style.setProperty('--total-scale-factor', String(vp.scale * (vp.userUnit || 1)));
      layer = new TextLayer({ textContentSource: data.content, container: textLayer.current, viewport: vp });
      // The library sets CSS round() dimensions. Explicit dimensions also support
      // older Electron/Chrome and keep rotated text in its unrotated coordinate box.
      textLayer.current.style.width = vp.rawDims.pageWidth * vp.scale * (vp.userUnit || 1) + 'px';
      textLayer.current.style.height = vp.rawDims.pageHeight * vp.scale * (vp.userUnit || 1) + 'px';
      await layer.render();
      if (version !== epoch.current) return;
      setRendering(false);
      setRenderKey([page, zoom, rotation, width].join(':'));
      preload = setTimeout(async () => {
        for (const number of [page + 1, page - 1]) {
          if (version !== epoch.current) return;
          if (number >= 1 && number <= currentEngine.pdf.numPages) await frameAt(number).catch(() => {});
        }
      }, 60);
      notify();
      clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(
        () => linkedRequest({ action: 'pdf.position', page }).catch((e) => setError(e.message)),
        500,
      );
      if (state.current.selection?.page === page && state.current.selection.rects?.length) {
        const b = viewportRect(vp, state.current.selection.rects[0]);
        scroller.current.scrollTop = Math.max(0, b.y - 100);
      }
    })().catch((e) => {
      if (version === epoch.current && !['RenderingCancelledException', 'AbortException'].includes(e.name)) {
        setError(e.message);
        setRendering(false);
      }
    });
    return () => {
      epoch.current++;
      clearTimeout(preload);
      layer?.cancel();
    };
  }, [loaded, page, zoom, rotation, width]);
  function selectText() {
    if (mode !== 'text' || rendering || !viewport.current) return;
    const s = window.getSelection();
    if (
      !s ||
      s.isCollapsed ||
      !textLayer.current.contains(s.anchorNode) ||
      !textLayer.current.contains(s.focusNode)
    )
      return;
    const quote = s.toString().trim();
    if (!quote) return;
    const box = pageBox.current.getBoundingClientRect(),
      rects = [...s.getRangeAt(0).getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1 && r.left >= box.left - 2 && r.right <= box.right + 2)
        .map((r) => pdfRect(viewport.current, r.left - box.left, r.top - box.top, r.width, r.height));
    if (rects.length > 300 || quote.length > 30000) {
      setError('选区较长，请按段落摘录');
      return;
    }
    if (rects.length) setSelection({ page, rects, quote, selectionType: 'text' });
  }
  function point(event) {
    const box = pageBox.current.getBoundingClientRect();
    return viewport.current.convertToPdfPoint(
      Math.max(0, Math.min(box.width, event.clientX - box.left)),
      Math.max(0, Math.min(box.height, event.clientY - box.top)),
    );
  }
  function down(event) {
    if (rendering || !viewport.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    gesture.current = { start: p, points: [p], page, mode };
    setDraftStroke({ ...gesture.current, end: p });
  }
  function move(event) {
    if (!gesture.current) return;
    const p = point(event);
    if (gesture.current.mode === 'ink') gesture.current.points.push(p);
    setDraftStroke({ ...gesture.current, end: p });
  }
  function up(event) {
    const g = gesture.current;
    if (!g) return;
    const end = point(event);
    gesture.current = null;
    setDraftStroke(null);
    if (g.mode === 'ink') {
      g.points.push(end);
      if (g.points.length > 1)
        save({
          id: crypto.randomUUID(),
          page: g.page,
          kind: 'ink',
          points: g.points,
          rects: [],
          quote: '',
          note: '',
        })
          .then((a) => setSelection(a))
          .catch((e) => setSaveError(e.message));
    } else {
      const rect = [
        Math.min(g.start[0], end[0]),
        Math.min(g.start[1], end[1]),
        Math.max(g.start[0], end[0]),
        Math.max(g.start[1], end[1]),
      ];
      if (rect[2] - rect[0] > 2 && rect[3] - rect[1] > 2) {
        setSelection({
          page: g.page,
          rects: [rect],
          quote: pdfSelectionText(pageData.current.items, [rect]),
          selectionType: 'region',
        });
        setMode('text');
      }
    }
  }
  async function extract(asImage = false) {
    const chosen = state.current.selection;
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      let image,
        size = {};
      if (asImage) {
        const result = await renderPdfRegion(
          engine.current,
          chosen.page,
          chosen.rects,
          chosen.kind === 'ink' ? chosen.points : [],
        );
        image = result.image;
        size = { width: result.canvas.width, height: result.canvas.height };
      }
      await onExtract({
        reference: pdfReference(documentInfo, {
          ...chosen,
          pageLabel: engine.current.labels?.[chosen.page - 1],
        }),
        text: chosen.quote,
        image,
        ...size,
      });
      setNotice('已放入右侧画布，选中摘录可回到原页');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function recognize(wholePage = false) {
    const chosen = wholePage ? { page, rects: [] } : state.current.selection;
    if (!chosen || chosen.kind === 'ink') return;
    setRecognizing(true);
    setError('');
    try {
      const { image } = await renderPdfRegion(engine.current, chosen.page, chosen.rects);
      const task = await linkedRequest({ action: 'pdf.recognize', page: chosen.page, image });
      let job = task;
      while (['queued', 'running'].includes(job.status) && alive.current) {
        await new Promise((r) => setTimeout(r, 600));
        job = await execute({ action: 'tasks.get', id: task.id });
      }
      if (!alive.current) return;
      if (job.status !== 'done') throw new Error(job.error || '识别未完成');
      const data = await engine.current.page(chosen.page);
      setEditor({
        id: crypto.randomUUID(),
        page: chosen.page,
        selectionType: 'region',
        rects: chosen.rects.length ? chosen.rects : [data.page.view],
        quote: job.result.text,
        note: '',
        origin: 'ocr',
        ocr: true,
      });
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setRecognizing(false);
    }
  }
  async function search() {
    if (!query.trim() || !engine.current) return;
    const token = ++searchEpoch.current;
    setSearching(true);
    setResults([]);
    setScanned(0);
    const found = [],
      needle = normalizePdfText(query).toLowerCase();
    try {
      for (let p = 1; p <= count; p++) {
        if (token !== searchEpoch.current || !alive.current) break;
        const data = await engine.current.page(p);
        await data.index();
        if (token !== searchEpoch.current) break;
        setScanned(p);
        if (normalizePdfText(data.text).toLowerCase().includes(needle)) {
          found.push({ page: p, text: data.text.replace(/\s+/g, ' ').slice(0, 180) });
          setResults([...found]);
          if (found.length === 50) break;
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      if (token === searchEpoch.current) setSearching(false);
    }
  }
  async function outlinePage(item) {
    try {
      const dest =
        typeof item.dest === 'string' ? await engine.current.pdf.getDestination(item.dest) : item.dest;
      if (!dest) return;
      const index = typeof dest[0] === 'number' ? dest[0] : await engine.current.pdf.getPageIndex(dest[0]);
      jump({ page: index + 1 });
    } catch (e) {
      setError(e.message);
    }
  }
  const visible = annotations.filter((a) => !a.deletedAt && a.page === page),
    styleRect = (r) => (viewport.current ? viewportRect(viewport.current, r) : {}),
    path = (points) =>
      points
        .map((p, i) => {
          const [x, y] = viewport.current.convertToViewportPoint(...p);
          return (i ? 'L' : 'M') + x + ' ' + y;
        })
        .join(' ');
  return (
    <section className="sb-pdf-reader study-comment-surface" ref={root}>
      <header className="sb-pdf-heading">
        <strong title={documentInfo.name}>{documentInfo.name}</strong>
        <button onClick={onManage}>管理 PDF</button>
        <button
          aria-label="收起 PDF"
          onClick={async () => {
            try {
              await session.current?.flush();
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          ×
        </button>
      </header>
      <div className="sb-pdf-toolbar">
        <button
          disabled={page <= 1 || !loaded}
          aria-label="PDF 上一页"
          title="上一页（←）"
          onClick={() => {
            setSelection(null);
            setPage((p) => p - 1);
          }}
        >
          ‹
        </button>
        <label>
          <input
            aria-label="PDF 页码"
            type="number"
            min="1"
            max={count || 1}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= count) {
                setSelection(null);
                setPage(n);
              }
            }}
          />
          <span>/ {count || '…'}</span>
        </label>
        <button
          disabled={page >= count || !loaded}
          aria-label="PDF 下一页"
          title="下一页（→）"
          onClick={() => {
            setSelection(null);
            setPage((p) => p + 1);
          }}
        >
          ›
        </button>
        <select aria-label="PDF 缩放" value={zoom} onChange={(e) => setZoom(e.target.value)}>
          <option value="fit">适应宽度</option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
            <option value={z} key={z}>
              {z * 100}%
            </option>
          ))}
        </select>
        <button title="旋转页面" onClick={() => setRotation((r) => (r + 90) % 360)}>
          ↻
        </button>
        <button
          onClick={() => {
            setShowOutline((v) => !v);
            setShowAnnotations(false);
          }}
        >
          目录
        </button>
        {['text', 'region', 'ink'].map((tool) => (
          <button
            key={tool}
            aria-pressed={mode === tool}
            onClick={() => {
              setMode(tool);
              gesture.current = null;
              setDraftStroke(null);
            }}
          >
            {{ text: '选文', region: '框选', ink: '笔迹' }[tool]}
          </button>
        ))}
        <button
          onClick={() => {
            setShowAnnotations((v) => !v);
            setShowOutline(false);
          }}
        >
          批注 {annotations.filter((a) => !a.deletedAt && a.kind !== 'reference').length}
        </button>
      </div>
      <div className="sb-pdf-search">
        <input
          aria-label="搜索 PDF"
          placeholder="搜索这份 PDF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search();
          }}
        />
        <button disabled={!loaded || searching || !query.trim()} onClick={search}>
          搜索
        </button>
        {searching && (
          <button
            onClick={() => {
              searchEpoch.current++;
              setSearching(false);
            }}
          >
            停止 {scanned}/{count}
          </button>
        )}
      </div>
      <div className="sb-pdf-discussion-tools">
        <CanvasComments
          key={documentInfo.id}
          rootRef={root}
          noteId={noteId}
          canvas={{ kind: 'pdf', id: documentInfo.id }}
          execute={execute}
          flush={() => session.current?.flush()}
          sourceAdapter={adapter}
          controlsRef={discussions}
          surfaceLabel="PDF"
          onSource={jump}
        />
      </div>
      {selection && (
        <div className="sb-pdf-selection-tools">
          <span>
            {selection.kind === 'ink'
              ? '已选笔迹'
              : selection.quote
                ? `已选 ${selection.quote.length} 字`
                : '已框选区域'}
          </span>
          <button disabled={busy} onClick={() => editAnnotation(selection)}>
            划线 / 批注
          </button>
          <button disabled={busy || !selection.quote} onClick={() => extract(false)}>
            摘录文字
          </button>
          <button disabled={busy} onClick={() => extract(true)}>
            截取到画布
          </button>
          <button
            disabled={busy || !canDiscuss}
            title={!canDiscuss ? '请在功能设置中开启提问与备注' : ''}
            onClick={() => discussions.current?.start()}
          >
            提问
          </button>
          <button
            disabled={recognizing || selection.kind === 'ink' || !ocrCapability?.available}
            title={ocrCapability?.reason || ''}
            onClick={() => recognize(false)}
          >
            {recognizing ? '识别中…' : '识别文字'}
          </button>
        </div>
      )}
      {password && (
        <form
          className="sb-pdf-password"
          onSubmit={(e) => {
            e.preventDefault();
            password.update(passwordValue);
            setPassword(null);
            setPasswordValue('');
          }}
        >
          <label>
            {password.reason === 2 ? '密码不正确，请重试' : '请输入 PDF 密码'}
            <input
              aria-label="PDF 密码"
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
            />
          </label>
          <button type="submit">打开</button>
        </form>
      )}
      {(error || saveError) && (
        <div className="sb-pdf-error" role="alert">
          {error || saveError}
          {saveError && <button onClick={() => session.current.flush().catch(() => {})}>重试保存</button>}
          {saveError && (
            <>
              <button
                onClick={() =>
                  download(
                    new Blob([JSON.stringify({ document: documentInfo, queue: session.current.queue })], {
                      type: 'application/json',
                    }),
                    filename(documentInfo.name + '-批注草稿', 'json'),
                  )
                }
              >
                下载批注草稿
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('放弃当前未保存的批注改动，并载入已保存版本？')) return;
                  try {
                    const remote = await linkedRequest({ action: 'pdf.list' });
                    await session.current.discard(
                      remote.notebook.annotations.filter((a) => a.documentId === documentInfo.id),
                    );
                  } catch (e) {
                    setSaveError(e.message);
                  }
                }}
              >
                放弃未保存改动
              </button>
            </>
          )}
        </div>
      )}
      {notice && (
        <div className="sb-pdf-notice" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="关闭 PDF 提示">
            ×
          </button>
        </div>
      )}
      <div className="sb-pdf-viewport" aria-busy={!loaded || rendering}>
        <div
          className="sb-pdf-scroll"
          ref={scroller}
          tabIndex={0}
          aria-label="PDF 阅读区"
          aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown"
          onPointerDown={(e) => {
            if (e.button === 0 && !e.target.closest('a,button,input,select,textarea,[contenteditable=true]'))
              e.currentTarget.focus({ preventScroll: true });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              gesture.current = null;
              setDraftStroke(null);
              setMode('text');
              setSelection(null);
            }
            if (
              e.target !== scroller.current ||
              e.ctrlKey ||
              e.metaKey ||
              e.altKey ||
              e.shiftKey ||
              e.isComposing ||
              !loaded
            )
              return;
            if (['ArrowRight', 'PageDown'].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              setSelection(null);
              window.getSelection()?.removeAllRanges();
              setPage((p) => Math.min(count, p + 1));
            }
            if (['ArrowLeft', 'PageUp'].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              setSelection(null);
              window.getSelection()?.removeAllRanges();
              setPage((p) => Math.max(1, p - 1));
            }
          }}
        >
          <div
            className="sb-pdf-page"
            ref={pageBox}
            style={{ width: size.width, height: size.height }}
            data-page={page}
            data-ready={!rendering && renderKey === [page, zoom, rotation, width].join(':')}
          >
            <canvas
              ref={canvas}
              style={{ width: size.width, height: size.height }}
              aria-label={'PDF 第 ' + page + ' 页'}
            />
            <svg className="sb-pdf-marks" width={size.width} height={size.height} aria-hidden="true">
              {viewport.current &&
                visible.map((a) =>
                  a.kind === 'ink' ? (
                    <path
                      key={a.id}
                      d={path(a.points)}
                      fill="none"
                      stroke="#d6503c"
                      strokeWidth={2 * viewport.current.scale}
                      strokeLinecap="round"
                    />
                  ) : a.kind === 'highlight' ? (
                    a.rects.map((r, i) => {
                      const b = styleRect(r);
                      return <rect key={a.id + i} {...b} fill="#ffd85a" opacity=".3" />;
                    })
                  ) : null,
                )}
              {viewport.current &&
                selection?.page === page &&
                selection.rects?.map((r, i) => (
                  <rect
                    key={'selection' + i}
                    {...styleRect(r)}
                    fill="#a9bbf2"
                    fillOpacity=".22"
                    stroke="#6c76c8"
                    strokeWidth="1"
                  />
                ))}
              {viewport.current &&
                draftStroke &&
                (draftStroke.mode === 'ink' ? (
                  <path d={path(draftStroke.points)} fill="none" stroke="#d6503c" strokeWidth="2" />
                ) : (
                  <rect
                    {...styleRect([
                      Math.min(draftStroke.start[0], draftStroke.end[0]),
                      Math.min(draftStroke.start[1], draftStroke.end[1]),
                      Math.max(draftStroke.start[0], draftStroke.end[0]),
                      Math.max(draftStroke.start[1], draftStroke.end[1]),
                    ])}
                    fill="#9caafa33"
                    stroke="#7d80c8"
                  />
                ))}
            </svg>
            <div
              ref={textLayer}
              className="textLayer"
              onPointerUp={() => requestAnimationFrame(selectText)}
              onKeyUp={selectText}
            />
            {mode !== 'text' && (
              <div
                className="sb-pdf-gesture"
                role="application"
                aria-label={mode === 'ink' ? 'PDF 手写批注' : 'PDF 框选区域'}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => {
                  gesture.current = null;
                  setDraftStroke(null);
                }}
              />
            )}
          </div>
        </div>
        {!password && !error && (!loaded || rendering) && (
          <p className="sb-pdf-loading sb-pdf-render-status" role="status">
            {loaded ? `正在显示第 ${page} 页…` : '正在打开 PDF…'}
          </p>
        )}
      </div>
      <footer className="sb-pdf-status">
        <span>
          {pending ? '批注保存中…' : saveError ? '批注待同步' : '批注已保存'} · PDF 第 {page} 页
          {engine.current?.labels?.[page - 1] && engine.current.labels[page - 1] !== String(page)
            ? ' / 文档页码 ' + engine.current.labels[page - 1]
            : ''}
        </span>
        <button
          disabled={!loaded || recognizing || !ocrCapability?.available}
          title={ocrCapability?.reason || ''}
          onClick={() => recognize(true)}
        >
          识别当前页
        </button>
      </footer>
      {(showOutline || showAnnotations || results) && (
        <aside className="sb-pdf-side-list">
          <header>
            <strong>{showOutline ? '目录' : showAnnotations ? '本篇笔记的 PDF 批注' : '搜索结果'}</strong>
            <button
              aria-label="关闭 PDF 列表"
              onClick={() => {
                setShowOutline(false);
                setShowAnnotations(false);
                setResults(null);
              }}
            >
              ×
            </button>
          </header>
          {showOutline &&
            (outline.length ? (
              outline.map((item, i) => (
                <button
                  key={i}
                  style={{ paddingLeft: 12 + Math.min(item.level, 4) * 12 }}
                  onClick={() => outlinePage(item)}
                >
                  {item.title}
                </button>
              ))
            ) : (
              <p>这份 PDF 没有目录，可用页码或搜索定位。</p>
            ))}
          {showAnnotations &&
            annotations
              .filter((a) => !a.deletedAt && a.kind !== 'reference')
              .map((a) => (
                <article key={a.id}>
                  <button onClick={() => jump({ ...a })}>
                    第 {a.page} 页 · {a.kind === 'ink' ? '手写笔迹' : (a.quote || '区域批注').slice(0, 65)}
                  </button>
                  {a.note && <p>{a.note}</p>}
                  <div>
                    <button onClick={() => editAnnotation(a)}>编辑备注</button>
                    <button
                      onClick={async () => {
                        try {
                          await save({ ...a, deleted: true });
                          setRemoved(a);
                        } catch (e) {
                          setSaveError(e.message);
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
          {removed && showAnnotations && (
            <p>
              批注已删除{' '}
              <button
                onClick={async () => {
                  try {
                    await save({ ...removed, deleted: false });
                    setRemoved(null);
                  } catch (e) {
                    setSaveError(e.message);
                  }
                }}
              >
                撤销
              </button>
            </p>
          )}
          {results && (
            <>
              <p>
                {searching
                  ? `正在检索 ${scanned}/${count} 页`
                  : `找到 ${results.length}${results.length === 50 ? ' 个以上' : ''}匹配页面`}
              </p>
              {results.map((r) => (
                <button key={r.page} onClick={() => jump({ page: r.page })}>
                  <strong>第 {r.page} 页</strong>
                  <small>{r.text}</small>
                </button>
              ))}
            </>
          )}
        </aside>
      )}
      {editor && (
        <div
          className="sb-pdf-editor"
          role="dialog"
          aria-label={editor.ocr ? '核对 PDF 文字' : 'PDF 划线批注'}
        >
          <header>
            <strong>{editor.ocr ? '核对识别文字' : '划线与备注'}</strong>
            <button onClick={() => setEditor(null)} aria-label="取消 PDF 批注">
              ×
            </button>
          </header>
          {editor.ocr ? (
            <label>
              核对原文
              <textarea
                aria-label="PDF 识别文字"
                maxLength={30000}
                value={editor.quote}
                rows={6}
                onChange={(e) => setEditor({ ...editor, quote: e.target.value })}
              />
            </label>
          ) : (
            <blockquote>
              {editor.quote?.slice(0, 400) || (editor.kind === 'ink' ? '已选中手写笔迹' : '已选中图表区域')}
            </blockquote>
          )}
          <label>
            备注（可留空）
            <textarea
              aria-label="PDF 批注内容"
              maxLength={6000}
              rows={3}
              value={editor.note || ''}
              onChange={(e) => setEditor({ ...editor, note: e.target.value })}
            />
          </label>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const a = await save({ ...editor, kind: editor.kind === 'ink' ? 'ink' : 'highlight' });
                setSelection(a);
                setEditor(null);
                setNotice('批注已保存，可在批注列表中定位、编辑或删除');
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存批注
          </button>
        </div>
      )}
    </section>
  );
});
export default PdfReader;
