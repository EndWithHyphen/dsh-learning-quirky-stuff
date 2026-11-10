import React, { useEffect, useRef, useState } from 'react';
const InfographicCanvas = React.lazy(() => import('./infographic-canvas.jsx'));
const exportInfographic = async (...args) =>
  (await import('./infographic-render.js')).exportInfographic(...args);

export function useSummaryInfographics({ api, noteId, summary, enabled, onError, onToast }) {
  const [manifest, setManifest] = useState({ entries: [], hidden: [] }),
    [composer, setComposer] = useState(null),
    [task, setTask] = useState(null),
    [notice, setNotice] = useState(null),
    [error, setError] = useState(''),
    [starting, setStarting] = useState(false),
    alive = useRef(0);
  async function refresh(generation = alive.current) {
    if (!enabled || !summary) return;
    const next = await api('execute', { action: 'infographics.list', noteId, summaryId: summary.id });
    if (generation === alive.current) setManifest(next);
  }
  useEffect(() => {
    const generation = ++alive.current;
    setManifest({ entries: [], hidden: [] });
    setComposer(null);
    setTask(null);
    setNotice(null);
    setError('');
    if (!enabled || !summary) return;
    refresh(generation).catch((e) => {
      if (alive.current === generation) setError(e.message);
    });
    api('execute', { action: 'tasks.list', feature: 'infographics' })
      .then((values) => {
        if (alive.current === generation)
          setTask(
            values.find(
              (t) => t.request.summaryId === summary.id && ['queued', 'running'].includes(t.status),
            ) || null,
          );
      })
      .catch(() => {});
    return () => {
      alive.current++;
    };
  }, [enabled, summary?.id]);
  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return;
    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const next = await api('execute', { action: 'tasks.get', id: task.id });
        if (stopped) return;
        setTask(next);
        if (next.status === 'done') {
          await refresh();
          if (stopped) return;
          if (next.result?.decision === 'compose') {
            setComposer(null);
            onToast('信息图已生成，旧版与手动编辑已保留');
          } else
            setNotice({
              conceptId: next.request.conceptId || '',
              text: next.result?.reason || '这部分用文字表达已经清楚，暂时无需重画。',
            });
        }
        if (['error', 'interrupted', 'cancelled'].includes(next.status)) setError(next.error);
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    }, 1100);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [task?.id, task?.status]);
  const busy = starting || ['queued', 'running'].includes(task?.status);
  async function start(route, instructions) {
    setStarting(true);
    setError('');
    setNotice(null);
    try {
      const [provider, model] = route.split('\n');
      if (!provider || !model) throw new Error('请先选择模型');
      const next = await api('execute', {
        action: 'infographics.start',
        noteId,
        summaryId: summary.id,
        conceptId: composer?.conceptId || '',
        replaceId: composer?.replaceId || '',
        instructions,
        route: { provider, model },
      });
      setTask(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }
  async function visibility(slotId, visible) {
    try {
      setManifest(
        await api('execute', {
          action: 'infographics.visibility',
          noteId,
          summaryId: summary.id,
          slotId,
          visible,
        }),
      );
    } catch (e) {
      onError(e);
    }
  }
  return {
    manifest,
    composer,
    setComposer,
    task,
    notice,
    error,
    busy,
    start,
    refresh,
    visibility,
    cancel: () => api('execute', { action: 'tasks.cancel', id: task.id }).then(setTask).catch(onError),
  };
}

function Figure({ versions, api, noteId, summaryId, controller, onError, onAddCard }) {
  const newest = versions.at(-1),
    [id, setId] = useState(newest.id),
    [data, setData] = useState(null),
    [scene, setScene] = useState(null),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(false),
    [sourceMode, setSourceMode] = useState(false),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    setId(newest.id);
  }, [newest.id]);
  useEffect(() => {
    let stopped = false,
      objectUrl;
    setData(null);
    setScene(null);
    setUrl('');
    setError('');
    (async () => {
      const response = await api('execute', { action: 'infographics.get', noteId, summaryId, id });
      const { buildInfographicScene, infographicSvg } = await import('./infographic-render.js');
      const drawing = response.canvas?.scene || (await buildInfographicScene(response.entry));
      const svg = await infographicSvg(drawing);
      objectUrl = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
      if (!stopped) {
        setData(response);
        setScene(drawing);
        setUrl(objectUrl);
      } else URL.revokeObjectURL(objectUrl);
    })().catch((e) => {
      if (!stopped) setError(e.message);
    });
    return () => {
      stopped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, epoch]);
  const chosen = versions.find((v) => v.id === id) || newest,
    current = data?.entry.id === id;
  return (
    <figure className="sb-info-card">
      <header>
        <h3>{chosen.title}</h3>
        <span>信息图</span>
      </header>
      {url && current ? (
        <button
          className="sb-info-preview"
          onClick={() => {
            setSourceMode(false);
            setEditing(true);
          }}
          aria-label={'编辑信息图：' + chosen.title}
        >
          <img src={url} alt={chosen.title} />
          <span>点击展开与编辑</span>
        </button>
      ) : (
        <p className={error ? 'sb-notice' : 'sb-muted'}>{error || '正在排版信息图…'}</p>
      )}
      {data?.entry.figure.caption && <figcaption>{data.entry.figure.caption}</figcaption>}
      <div className="sb-info-actions">
        {versions.length > 1 && (
          <select aria-label="信息图版本" value={id} onChange={(e) => setId(e.target.value)}>
            {versions.map((version, i) => (
              <option key={version.id} value={version.id}>
                {i === 0 ? '初版' : '第 ' + (i + 1) + ' 版'} ·{' '}
                {new Date(version.createdAt).toLocaleString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </option>
            ))}
          </select>
        )}
        <button
          className="sb-button"
          disabled={!scene || !current}
          onClick={() => {
            setSourceMode(false);
            setEditing(true);
          }}
        >
          编辑
        </button>
        <button
          className="sb-button"
          disabled={!scene || !current}
          onClick={() => {
            setSourceMode(true);
            setEditing(true);
          }}
        >
          来源
        </button>
        <button
          className="sb-button"
          disabled={!scene || !current}
          onClick={() => exportInfographic(scene, chosen.title, 'png').catch(onError)}
        >
          下载图片
        </button>
        <button
          className="sb-button"
          disabled={!scene || !current}
          onClick={() => onAddCard({ infographicScene: scene, id: summaryId })}
        >
          放回白板
        </button>
        <button
          className="sb-button"
          disabled={controller.busy}
          onClick={() =>
            controller.setComposer({ conceptId: chosen.conceptId, replaceId: id, title: chosen.title })
          }
        >
          重新生成
        </button>
        <button className="sb-button" onClick={() => controller.visibility(chosen.slotId, false)}>
          隐藏
        </button>
      </div>
      {editing && data && (
        <React.Suspense fallback={<p className="sb-muted">正在打开编辑画布…</p>}>
          <InfographicCanvas
            key={id}
            entry={data.entry}
            saved={data.canvas}
            initialScene={scene}
            api={api}
            sourcesInitially={sourceMode}
            onError={onError}
            onSaved={() => {
              setEpoch((v) => v + 1);
            }}
            onClose={() => setEditing(false)}
          />
        </React.Suspense>
      )}
    </figure>
  );
}

export function InfographicRegion({
  conceptId = '',
  controller,
  api,
  noteId,
  summaryId,
  route,
  models,
  chooseRoute,
  onError,
  onAddCard,
}) {
  const [instructions, setInstructions] = useState('');
  const entries = controller.manifest.entries.filter((e) => (e.conceptId || '') === conceptId),
    groups = new Map();
  for (const entry of entries) groups.set(entry.slotId, [...(groups.get(entry.slotId) || []), entry]);
  const composer = controller.composer && controller.composer.conceptId === conceptId,
    activeTask = controller.task?.request?.conceptId === conceptId,
    hidden = [...groups].filter(([id]) => controller.manifest.hidden.includes(id));
  useEffect(() => {
    setInstructions('');
  }, [controller.composer]);
  return (
    <div className="sb-info-region">
      {composer && (
        <section className="sb-info-composer">
          <header>
            <strong>{controller.composer.replaceId ? '重新组织这张信息图' : '为这个主题配图'}</strong>
            <button
              className="sb-icon"
              aria-label="关闭信息图生成"
              onClick={() => controller.setComposer(null)}
            >
              ×
            </button>
          </header>
          <p>模型会判断是否需要配图，并按内容选择表达形式。</p>
          <label>
            模型
            <select aria-label="信息图模型" value={route} onChange={(e) => chooseRoute(e.target.value)}>
              {models.map((m) => (
                <option key={m.provider + m.id} value={m.provider + '\n' + m.id} disabled={!!m.unavailable}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="信息图补充要求"
            placeholder="可补充要突出的关系、想比较的问题，或对上一版的修改意见"
            value={instructions}
            maxLength={1800}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <button
            className="sb-button sb-primary"
            disabled={controller.busy || !route}
            onClick={() => controller.start(route, instructions)}
          >
            按内容生成
          </button>
        </section>
      )}
      {activeTask && controller.busy && (
        <div className="sb-module-progress" role="status">
          <span className="sb-pulse" />
          <p>{controller.task.phase}</p>
          <button className="sb-button" onClick={controller.cancel}>
            取消
          </button>
        </div>
      )}
      {(composer || activeTask || !conceptId) && controller.error && (
        <p className="sb-notice" role="alert">
          {controller.error}
        </p>
      )}
      {controller.notice?.conceptId === conceptId && (
        <p className="sb-info-decision">{controller.notice.text}</p>
      )}
      {[...groups]
        .filter(([id]) => !controller.manifest.hidden.includes(id))
        .map(([slotId, versions]) => (
          <Figure
            key={slotId}
            versions={versions}
            {...{ api, noteId, summaryId, controller, onError, onAddCard }}
          />
        ))}
      {!!hidden.length && (
        <details className="sb-info-hidden">
          <summary>已隐藏 {hidden.length} 张信息图</summary>
          {hidden.map(([slotId, versions]) => (
            <div key={slotId}>
              <span>{versions.at(-1).title}</span>
              <button className="sb-button" onClick={() => controller.visibility(slotId, true)}>
                恢复显示
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
