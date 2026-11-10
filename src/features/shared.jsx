import React, { useEffect, useRef, useState } from 'react';
import { useLearning } from './context.jsx';
import { timestampUrl } from '../../shared/material-text.js';

export const Action = ({ children, primary = false, ...props }) => (
  <button {...props} className={'sb-button ' + (primary ? 'sb-primary ' : '') + (props.className || '')}>
    {children}
  </button>
);
export const displayText = (value) =>
  String(value || '')
    .replace(/\s*[（(\[]R\d{3}(?:\s*[,，、]\s*R\d{3})*[)）\]]/g, '')
    .replace(/\bR\d{3}\b/g, '材料');
export const ErrorNotice = ({ error }) =>
  error ? (
    <p className="sb-notice" role="alert">
      {typeof error === 'string' ? error : error.message}
    </p>
  ) : null;
export function readDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    const raw = localStorage.getItem(key);
    if (raw)
      try {
        localStorage.setItem(key + ':unreadable-backup', raw);
      } catch {}
    return {};
  }
}
export const date = (value) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function ModelPicker({ feature }) {
  const learning = useLearning(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!learning.models.length) learning.loadModels();
  }, []);
  const route = learning.settings?.models?.[feature],
    value = route?.provider ? route.provider + '\n' + route.model : '',
    selected =
      learning.models.find((model) => model.provider + '\n' + model.id === value) ||
      learning.models.find((model) => model.configured) ||
      learning.models[0];
  async function choose(value) {
    setBusy(true);
    try {
      const [provider = '', model = ''] = value.split('\n');
      await learning.update({ models: { [feature]: { provider, model } } });
      setError('');
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sb-module-model">
      <label>
        模型
        <select
          aria-label="学习工具模型"
          value={value}
          onChange={(event) => choose(event.target.value)}
          disabled={busy}
        >
          <option value="">沿用默认模型{selected ? ' · ' + selected.name : ''}</option>
          {learning.models.map((model) => (
            <option key={model.provider + model.id} value={model.provider + '\n' + model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <button aria-label="刷新学习工具模型" onClick={() => learning.loadModels()}>
        ↻
      </button>
      <small>{selected?.reasoningEffort ? '推理强度 ' + selected.reasoningEffort : ''}</small>
      <ErrorNotice error={error || learning.modelError} />
    </div>
  );
}
export function useTask(feature, onDone, key = null) {
  const { api } = useLearning(),
    [task, setTask] = useState(null),
    [error, setError] = useState(''),
    done = useRef(onDone),
    seen = useRef(new Set());
  done.current = onDone;
  useEffect(() => {
    let stopped = false;
    api('execute', { action: 'tasks.list', feature })
      .then((tasks) => {
        if (stopped) return;
        const active = tasks.find(
          (task) => ['queued', 'running'].includes(task.status) && (!key || task.key === key),
        );
        setTask(active || null);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [feature, key]);
  useEffect(() => {
    if (!task?.id || !['queued', 'running'].includes(task.status)) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api('execute', { action: 'tasks.get', id: task.id });
        if (stopped) return;
        setTask(next);
        if (next.status === 'done' && !seen.current.has(next.id)) {
          seen.current.add(next.id);
          await done.current?.(next.result, next);
        }
      } catch (error) {
        if (!stopped) setError(error.message);
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.status]);
  async function start(request) {
    setError('');
    try {
      const next = typeof request === 'function' ? await request() : await api('execute', request);
      setTask(next);
      if (next.status === 'done') {
        if (next.id) seen.current.add(next.id);
        await done.current?.(next.result, next);
      }
      return next;
    } catch (error) {
      setError(error.message);
      return null;
    }
  }
  async function cancel() {
    if (!task?.id) return;
    try {
      setTask(await api('execute', { action: 'tasks.cancel', id: task.id }));
    } catch (error) {
      setError(error.message);
    }
  }
  return { task, error, start, cancel, busy: ['queued', 'running'].includes(task?.status) };
}
export function TaskProgress({ controller }) {
  const { task, error, busy } = controller;
  return (
    <>
      <ErrorNotice
        error={error || (['error', 'interrupted', 'cancelled'].includes(task?.status) ? task.error : '')}
      />
      {busy && (
        <div className="sb-module-progress" role="status">
          <span className="sb-pulse" />
          <div>
            <strong>{task.title}</strong>
            <p>
              {task.phase}
              {task.startedAt
                ? ' · 已用时 ' +
                  Math.max(0, Math.floor((Date.now() - Date.parse(task.startedAt)) / 60000)) +
                  ' 分 ' +
                  Math.max(0, Math.floor((Date.now() - Date.parse(task.startedAt)) / 1000) % 60) +
                  ' 秒'
                : ''}
            </p>
          </div>
          <Action onClick={controller.cancel}>取消</Action>
        </div>
      )}
    </>
  );
}

export function Evidence({ sources = [] }) {
  const learning = useLearning(),
    [selected, setSelected] = useState(null),
    [image, setImage] = useState(null),
    [error, setError] = useState(''),
    close = useRef();
  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    setImage(null);
    setError('');
    close.current?.focus({ preventScroll: true });
    if (selected.kind === 'image')
      learning
        .api('execute', { action: 'sources.get', id: selected.id })
        .then((result) => {
          if (!stopped) setImage(result.image);
        })
        .catch((error) => {
          if (!stopped) setError(error.message);
        });
    return () => {
      stopped = true;
    };
  }, [selected?.id]);
  return (
    <>
      <div className="sb-evidence-links">
        {[...new Map(sources.map((source) => [source.id, source])).values()].map((source, index) => (
          <button key={source.id} onClick={() => setSelected(source)} title={source.title}>
            [{index + 1}]{' '}
            {source.reportId
              ? '整理结果'
              : source.kind === 'material'
                ? '材料'
                : source.kind === 'visual'
                  ? '白板图像'
                  : source.kind === 'review'
                    ? '复习作答'
                    : source.summaryId
                      ? 'AI 总结'
                      : source.kind === 'image'
                        ? '原图'
                        : source.kind === 'handwriting'
                          ? '手写'
                          : '笔记'}{' '}
            · {source.title.length > 24 ? source.title.slice(0, 24) + '…' : source.title}
          </button>
        ))}
      </div>
      {selected && (
        <div
          className="sb-mask"
          onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}
        >
          <section
            className="sb-modal sb-source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="原文依据"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSelected(null);
              }
            }}
          >
            <header>
              <h2>原文依据</h2>
              <button ref={close} aria-label="关闭原文依据" onClick={() => setSelected(null)}>
                ×
              </button>
            </header>
            <h3>{selected.title}</h3>
            {selected.publishedAt && <p className="sb-muted">来源标注的发布日期：{selected.publishedAt}</p>}
            <blockquote>{selected.quote || selected.text}</blockquote>
            {image && <img src={image} alt={selected.title} />}
            <ErrorNotice error={error} />
            <footer>
              {selected.boardId && !selected.materialId && !selected.reportId && (
                <Action
                  primary
                  onClick={() => {
                    setSelected(null);
                    learning.navigation.current.openSource?.(selected);
                  }}
                >
                  定位到笔记
                </Action>
              )}
              {selected.reportId && (
                <Action
                  primary
                  onClick={() => {
                    setSelected(null);
                    learning.navigation.current.openSource?.(selected);
                  }}
                >
                  查看整理结果
                </Action>
              )}
              {selected.materialId && (
                <Action
                  onClick={() => {
                    setSelected(null);
                    learning.navigation.current.openSource?.(selected);
                  }}
                >
                  查看材料段落
                </Action>
              )}
              {selected.url && (
                <a
                  className="sb-button"
                  href={timestampUrl(selected.url, selected.locator?.seconds)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.locator?.seconds != null ? '打开视频位置' : '打开原网页'} ↗
                </a>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
export function Claim({ value }) {
  return value ? (
    <div className="sb-cited-claim">
      <p>{displayText(value.text)}</p>
      <Evidence sources={value.evidence} />
    </div>
  ) : null;
}
export function ReportStatus({ report }) {
  if (!report) return null;
  return (
    <>
      {report.unavailable ? (
        <p className="sb-notice">引用的笔记、总结或材料已删除，恢复来源或重新生成后可查看。</p>
      ) : report.stale ? (
        <p className="sb-notice">资料已有变化，下面是上次保存的结果，可重新生成。</p>
      ) : null}
      <p className="sb-module-meta">
        {date(report.createdAt)} · {report.model?.name || report.model?.id}
        {report.model?.reasoningEffort ? ' · ' + report.model.reasoningEffort : ''}
      </p>
    </>
  );
}
export function useCatalog() {
  const { api } = useLearning(),
    [catalog, setCatalog] = useState({ notes: [], materials: [] });
  const reload = () => api('execute', { action: 'sources.catalog' }).then(setCatalog);
  useEffect(() => {
    reload().catch(() => {});
  }, []);
  return [catalog, reload];
}
