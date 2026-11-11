import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import { commentSelection, commentSourceContent, commentCanvasKey } from '../shared/canvas-comments.js';
import { draftRead, draftPut } from './drafts.js';
import css from './canvas-comments.css';

const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const hash = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const activeTask = (m) => m.task && ['queued', 'running'].includes(m.task.status);
const stamp = (value) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function CanvasComments({
  apiRef,
  rootRef,
  noteId,
  canvas = { kind: 'note' },
  execute,
  flush,
  enabled: configured,
}) {
  const canvasKey = commentCanvasKey(canvas),
    key = noteId + ':canvas-comments:' + canvasKey,
    services = useRef({ execute, flush, canvas }),
    mounted = useRef(false),
    sending = useRef(false),
    threadsRef = useRef([]),
    draftRef = useRef({}),
    panelRef = useRef(),
    geometry = useRef(() => {}),
    [enabled, setEnabled] = useState(configured !== false),
    [root, setRoot] = useState(null),
    [threads, setThreads] = useState([]),
    [selected, setSelected] = useState([]),
    [pins, setPins] = useState([]),
    [open, setOpen] = useState(null),
    [draft, setDraft] = useState({}),
    [discarded, setDiscarded] = useState(null),
    [changingDraft, setChangingDraft] = useState(false),
    [ready, setReady] = useState(false),
    [models, setModels] = useState([]),
    [route, setRoute] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [resolved, setResolved] = useState(false),
    [bounds, setBounds] = useState({ top: 12, height: 500 });
  services.current = { execute, flush, canvas };
  threadsRef.current = threads;
  draftRef.current = draft;
  async function refresh() {
    const next = await services.current.execute({
      action: 'canvasComments.list',
      noteId,
      canvas: services.current.canvas,
    });
    if (mounted.current) setThreads(next);
    return next;
  }
  async function loadModels() {
    try {
      const next = await services.current.execute({ action: 'features.models' });
      if (mounted.current) {
        setModels(next);
        setError('');
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let stopped = false,
      frame,
      off,
      resize;
    draftRead(key)
      .then((saved) => {
        if (!stopped) {
          setDraft(saved || {});
          setReady(true);
        }
      })
      .catch((e) => {
        if (!stopped) {
          setReady(true);
          setError('备注草稿读取失败：' + e.message);
        }
      });
    const load = async () => {
      try {
        const settings = await services.current.execute({ action: 'features.get' });
        if (stopped) return;
        setEnabled(settings.features.canvasComments === true);
        const model = settings.models.canvasComments;
        setRoute(model?.provider ? model.provider + '\n' + model.model : '');
        if (settings.features.canvasComments) await refresh();
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    };
    load();
    window.addEventListener('focus', load);
    const attach = () => {
      if (stopped) return;
      const api = apiRef.current,
        host = rootRef.current;
      if (!api || !host) {
        frame = requestAnimationFrame(attach);
        return;
      }
      setRoot(host);
      const update = () => {
        if (stopped) return;
        const s = api.getAppState(),
          elements = api.getSceneElements(),
          rect = host.getBoundingClientRect(),
          engine = host.querySelector('.excalidraw')?.getBoundingClientRect();
        if (!engine) return;
        const ids = elements.filter((e) => !e.isDeleted && s.selectedElementIds[e.id]).map((e) => e.id);
        setSelected((old) => (JSON.stringify(old) === JSON.stringify(ids) ? old : ids));
        const next = threadsRef.current
          .filter((t) => !t.resolvedAt)
          .flatMap((t) => {
            const objects = elements.filter((e) => !e.isDeleted && t.elementIds.includes(e.id));
            if (!objects.length) return [];
            const [, top, right] = getCommonBounds(objects),
              x = engine.left - rect.left + (right + s.scrollX) * s.zoom.value + 5,
              y = engine.top - rect.top + (top + s.scrollY) * s.zoom.value - 9;
            if (x < 0 || x > rect.width - 24 || y < engine.top - rect.top || y > rect.height - 24) return [];
            return [{ id: t.id, x, y }];
          });
        // Stack threads attached to the same component so every marker remains clickable.
        for (let i = 0; i < next.length; i++)
          for (let j = 0; j < i; j++)
            if (Math.abs(next[i].x - next[j].x) < 25 && Math.abs(next[i].y - next[j].y) < 25)
              next[i].y = next[j].y + 29;
        setPins((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
        const b = { top: Math.max(8, engine.top - rect.top + 8), height: Math.max(160, engine.height - 16) };
        setBounds((old) => (old.top === b.top && old.height === b.height ? old : b));
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
      };
      geometry.current = schedule;
      off = api.onChange(schedule);
      resize = new ResizeObserver(schedule);
      resize.observe(host);
      schedule();
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stopped = true;
      mounted.current = false;
      cancelAnimationFrame(frame);
      off?.();
      resize?.disconnect();
      window.removeEventListener('focus', load);
    };
  }, [key]);
  useEffect(() => {
    geometry.current();
  }, [threads]);
  useEffect(() => {
    if (configured !== undefined) setEnabled(configured);
  }, [configured]);
  useEffect(() => {
    if (!open || !enabled) return;
    loadModels();
    const id = setInterval(
      () =>
        refresh().catch((e) => {
          if (mounted.current) setError(e.message);
        }),
      2000,
    );
    return () => clearInterval(id);
  }, [!!open, enabled]);
  useEffect(() => {
    if (open && open !== 'list') panelRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [open]);
  function saveDraft(next) {
    draftRef.current = next;
    setDraft(next);
    return draftPut(key, next).catch((e) => {
      if (mounted.current) setError('备注草稿保存失败：' + e.message);
      throw e;
    });
  }
  function start() {
    const ids = commentSelection(apiRef.current.getSceneElements(), selected).map((e) => e.id);
    if (!ids.length) return;
    const signature = JSON.stringify([...ids].sort()),
      existing = threads.find((t) => !t.resolvedAt && JSON.stringify([...t.elementIds].sort()) === signature);
    if (existing) {
      setOpen(existing.id);
      return;
    }
    const pending = Object.values(draftRef.current).find(
      (t) =>
        t?.elementIds &&
        JSON.stringify([...t.elementIds].sort()) === signature &&
        !threads.some((v) => v.id === t.id),
    );
    const id = pending?.id || crypto.randomUUID();
    if (!pending) saveDraft({ ...draftRef.current, [id]: { id, elementIds: ids, body: '' } }).catch(() => {});
    setError('');
    setOpen(id);
  }
  async function discardDraft(id) {
    const removed = draftRef.current[id];
    if (!removed || changingDraft) return;
    setChangingDraft(true);
    const next = { ...draftRef.current };
    delete next[id];
    try {
      await saveDraft(next);
      setDiscarded({ id, value: removed });
      setError('');
    } catch {
      const restored = { ...draftRef.current, [id]: removed };
      draftRef.current = restored;
      setDraft(restored);
    } finally {
      setChangingDraft(false);
    }
  }
  async function restoreDraft() {
    if (!discarded || changingDraft) return;
    setChangingDraft(true);
    try {
      await saveDraft({ ...draftRef.current, [discarded.id]: discarded.value });
      setDiscarded(null);
      setError('');
    } catch {
    } finally {
      setChangingDraft(false);
    }
  }
  const thread = threads.find((t) => t.id === open),
    form = draft[open] || {},
    elementIds = thread?.elementIds || form.elementIds || [],
    missing = thread?.sourceStatus === 'missing',
    running = thread?.messages.some(activeTask),
    write = (body) =>
      saveDraft({
        ...draftRef.current,
        [open]: { ...form, id: open, elementIds, body, pending: null },
      }).catch(() => {});
  async function send(ask, retryBody) {
    if (sending.current) return;
    const body = (retryBody || form.body || '').trim();
    if (!body) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const id = open,
      initialBody = form.body || '';
    try {
      await tick();
      await services.current.flush();
      if (!mounted.current) return;
      const api = apiRef.current,
        selected = commentSelection(api.getSceneElements(), elementIds),
        files = api.getFiles();
      if (elementIds.some((id) => !selected.some((e) => e.id === id)))
        throw new Error('所选组件已删除，请重新选择');
      const sourceHash = await hash(commentSourceContent(selected, files));
      let image;
      if (selected.some((e) => e.type !== 'text')) {
        const preview = await exportToCanvas({
          elements: selected,
          files,
          appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
          exportPadding: 24,
          getDimensions: (w, h) => {
            const scale = Math.min(1.5, 1800 / w, 1800 / h);
            return { width: Math.ceil(w * scale), height: Math.ceil(h * scale), scale };
          },
        });
        image = { mimeType: 'image/jpeg', data: preview.toDataURL('image/jpeg', 0.85).split(',')[1] };
        if (image.data.length > 2_000_000) throw new Error('所选图片过大，请缩小范围再提问');
      }
      if (!mounted.current) return;
      // Reuse the request ID after a lost response, but a deliberate retry starts a new task.
      const pending =
        !retryBody && form.pending?.body === body && form.pending.ask === ask
          ? form.pending
          : { requestId: crypto.randomUUID(), body, ask };
      await saveDraft({
        ...draftRef.current,
        [id]: { ...(draftRef.current[id] || form), id, elementIds, pending },
      });
      const [provider, model] = route.split('\n');
      await services.current.execute({
        action: 'canvasComments.send',
        noteId,
        canvas: services.current.canvas,
        threadId: id,
        requestId: pending.requestId,
        elementIds,
        sourceHash,
        body,
        ask,
        image,
        route: provider ? { provider, model } : {},
      });
      if (!mounted.current) return;
      const current = draftRef.current[id] || {};
      await saveDraft({
        ...draftRef.current,
        [id]: { ...current, pending: null, body: current.body === initialBody ? '' : current.body },
      });
      await refresh();
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function resolve(value) {
    try {
      await services.current.execute({
        action: 'canvasComments.resolve',
        noteId,
        canvas: services.current.canvas,
        threadId: open,
        resolved: value,
      });
      await refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  function locate(t) {
    const api = apiRef.current,
      elements = api.getSceneElements().filter((e) => t.elementIds.includes(e.id));
    if (elements.length) {
      api.updateScene({
        appState: { selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])) },
      });
      api.scrollToContent(elements, { fitToViewport: true, maxZoom: 1, viewportZoomFactor: 0.6 });
    }
    setOpen(t.id);
  }
  const source = thread?.source;
  return (
    enabled && (
      <>
        <style>{css}</style>
        <button
          type="button"
          className="study-shortcut-button"
          disabled={!selected.length || !ready}
          onClick={start}
          title="选择组件后向 AI 提问，或留下自己的备注"
        >
          提问 / 备注
        </button>
        <button
          type="button"
          className="study-shortcut-button"
          onClick={() => {
            setOpen(open === 'list' ? null : 'list');
            setError('');
          }}
          aria-label="画布备注列表"
        >
          备注{threads.length ? ` ${threads.filter((t) => !t.resolvedAt).length}` : ''}
        </button>
        {root &&
          createPortal(
            <div className="study-comments-overlay">
              {pins.map((p, i) => (
                <button
                  type="button"
                  className={'study-comment-pin' + (open === p.id ? ' active' : '')}
                  key={p.id}
                  style={{ left: p.x, top: p.y }}
                  aria-label={'打开画布备注 ' + (i + 1)}
                  onClick={() => setOpen(p.id)}
                >
                  {i + 1}
                </button>
              ))}
              {open && (
                <section
                  className="study-comment-panel"
                  ref={panelRef}
                  role="dialog"
                  aria-label="画布提问与备注"
                  style={{ top: bounds.top, maxHeight: bounds.height }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setOpen(null);
                    }
                  }}
                >
                  <header>
                    <strong>{open === 'list' ? '画布备注' : '组件讨论'}</strong>
                    <div>
                      {open !== 'list' && (
                        <button type="button" onClick={() => setOpen('list')}>
                          全部
                        </button>
                      )}
                      <button type="button" aria-label="关闭画布备注" onClick={() => setOpen(null)}>
                        ×
                      </button>
                    </div>
                  </header>
                  <div className="study-comment-scroll">
                    {open === 'list' ? (
                      <>
                        <label className="study-comment-filter">
                          <input
                            type="checkbox"
                            checked={resolved}
                            onChange={(e) => setResolved(e.target.checked)}
                          />
                          显示已解决
                        </label>
                        {!threads.filter((t) => resolved || !t.resolvedAt).length && (
                          <p className="study-comment-muted">
                            选中画布中的文字、图片或一组组件，即可提问或添加备注。
                          </p>
                        )}
                        {threads
                          .filter((t) => resolved || !t.resolvedAt)
                          .map((t) => (
                            <button
                              type="button"
                              className="study-comment-list-item"
                              key={t.id}
                              onClick={() => locate(t)}
                            >
                              <b>{t.messages[0]?.body.slice(0, 90) || '组件备注'}</b>
                              <small>
                                {t.resolvedAt ? '已解决 · ' : ''}
                                {t.messages.length} 条 · {stamp(t.createdAt)}
                                {t.sourceStatus === 'missing' ? ' · 组件已删除' : ''}
                              </small>
                            </button>
                          ))}
                        {Object.values(draft)
                          .filter((d) => d?.body && !threads.some((t) => t.id === d.id))
                          .map((d) => (
                            <div className="study-comment-draft-row" key={d.id}>
                              <button
                                type="button"
                                className="study-comment-list-item"
                                onClick={() => setOpen(d.id)}
                              >
                                <b>{d.body.slice(0, 90)}</b>
                                <small>未发送草稿</small>
                              </button>
                              <button
                                type="button"
                                className="study-comment-delete-draft"
                                aria-label={'删除草稿：' + d.body.slice(0, 30)}
                                disabled={busy || changingDraft}
                                onClick={() => discardDraft(d.id)}
                              >
                                删除草稿
                              </button>
                            </div>
                          ))}
                        {discarded && (
                          <div className="study-comment-draft-undo" role="status">
                            <span>草稿已删除</span>
                            <button type="button" disabled={changingDraft} onClick={restoreDraft}>
                              撤销删除
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="study-comment-context">
                          <span>关联 {elementIds.length} 个组件</span>
                          {thread && (
                            <button type="button" onClick={() => locate(thread)}>
                              定位
                            </button>
                          )}
                        </div>
                        {thread?.sourceStatus !== 'current' && thread && (
                          <p className="study-comment-notice">
                            {missing
                              ? '关联组件已删除。讨论和当时的来源仍保留。'
                              : '来源已变化。已有回答基于提问时的内容，追问会使用当前组件。'}
                          </p>
                        )}
                        {source && (
                          <details className="study-comment-source">
                            <summary>最初来源</summary>
                            {source.image && <img src={source.image} alt="提问时的所选组件" />}
                            {source.text && <p>{source.text}</p>}
                          </details>
                        )}
                        <div aria-live="polite" className="study-comment-messages">
                          {(thread?.messages || []).map((m) => (
                            <article key={m.id} className={'study-comment-message ' + m.role}>
                              <div className="study-comment-byline">
                                <b>
                                  {m.role === 'assistant'
                                    ? 'AI 回答'
                                    : m.role === 'question'
                                      ? '我的提问'
                                      : '我的备注'}
                                </b>
                                <time>{stamp(m.createdAt)}</time>
                              </div>
                              <div className="study-comment-body">{m.body}</div>
                              {m.model && (
                                <small className="study-comment-muted">{m.model.name || m.model.id}</small>
                              )}
                              {m.sourceHash && source && m.sourceHash !== source.hash && (
                                <small className="study-comment-muted">基于更新后的组件</small>
                              )}
                              {activeTask(m) && (
                                <div className="study-comment-job">
                                  <span>{m.task.phase}</span>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await services.current.execute({
                                          action: 'tasks.cancel',
                                          id: m.task.id,
                                        });
                                        await refresh();
                                      } catch (e) {
                                        setError(e.message);
                                      }
                                    }}
                                  >
                                    停止
                                  </button>
                                </div>
                              )}
                              {m.task && ['error', 'cancelled', 'interrupted'].includes(m.task.status) && (
                                <div className="study-comment-notice">
                                  {m.task.error}
                                  <button
                                    type="button"
                                    disabled={busy || running || missing || !!thread.resolvedAt}
                                    onClick={() => send(true, m.body)}
                                  >
                                    重新提问
                                  </button>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                        {thread?.resolvedAt ? (
                          <div className="study-comment-context">
                            <span>已解决</span>
                            <button type="button" onClick={() => resolve(false)}>
                              重新打开
                            </button>
                          </div>
                        ) : (
                          <>
                            <label className="study-comment-model">
                              提问模型
                              <div>
                                <select
                                  aria-label="画布提问模型"
                                  value={route}
                                  onChange={async (e) => {
                                    const value = e.target.value,
                                      [provider = '', model = ''] = value.split('\n');
                                    try {
                                      await services.current.execute({
                                        action: 'canvasComments.model',
                                        route: { provider, model },
                                      });
                                      setRoute(value);
                                      setError('');
                                    } catch (e) {
                                      setError(e.message);
                                    }
                                  }}
                                >
                                  <option value="">沿用默认模型</option>
                                  {route && !models.some((m) => m.provider + '\n' + m.id === route) && (
                                    <option value={route}>{route.split('\n').at(-1)}</option>
                                  )}
                                  {models.map((m) => (
                                    <option
                                      key={m.provider + m.id}
                                      value={m.provider + '\n' + m.id}
                                      disabled={!!m.unavailable}
                                    >
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                                <button type="button" aria-label="刷新画布提问模型" onClick={loadModels}>
                                  ↻
                                </button>
                              </div>
                            </label>
                            <label className="study-comment-compose">
                              提问或备注
                              <textarea
                                aria-label="提问或备注"
                                rows={4}
                                maxLength={6000}
                                value={form.body || ''}
                                disabled={!ready || missing}
                                placeholder="对这部分有什么疑问或想法？"
                                onChange={(e) => write(e.target.value)}
                              />
                            </label>
                            <div className="study-comment-actions">
                              <button
                                type="button"
                                disabled={busy || missing || !form.body?.trim()}
                                onClick={() => send(false)}
                              >
                                留下备注
                              </button>
                              <button
                                type="button"
                                className="study-comment-primary"
                                disabled={busy || running || missing || !form.body?.trim()}
                                onClick={() => send(true)}
                              >
                                {busy ? '正在提交…' : '问 AI'}
                              </button>
                            </div>
                            {thread && (
                              <button
                                type="button"
                                className="study-comment-resolve"
                                disabled={busy || running}
                                onClick={() => resolve(true)}
                              >
                                标记已解决
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {error && (
                      <p className="study-comment-notice" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>,
            root,
          )}
      </>
    )
  );
}
