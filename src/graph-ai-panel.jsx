import React, { useEffect, useState } from 'react';
const B = ({ children, primary = false, ...props }) => (
  <button {...props} className={'sb-button ' + (primary ? 'sb-primary' : '')}>
    {children}
  </button>
);
export default function GraphAiPanel({ graph, api, onError, onRefresh }) {
  const [models, setModels] = useState([]),
    [route, setRoute] = useState(() =>
      graph.aiSettings?.provider
        ? graph.aiSettings.provider + '\n' + graph.aiSettings.model
        : localStorage.getItem('studyboard-graph-model') || '',
    ),
    [focus, setFocus] = useState(graph.aiSettings?.focus || ''),
    [settingsOpen, setSettingsOpen] = useState(!graph.aiReport),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState(graph.aiJob),
    [loading, setLoading] = useState(false);
  const running = job?.status === 'running',
    report = graph.aiReport,
    selected = models.find((m) => m.provider + '\n' + m.id === route);
  async function loadModels() {
    setLoading(true);
    try {
      const values = await api('models');
      setModels(values);
      setRoute((old) =>
        values.some((m) => m.provider + '\n' + m.id === old)
          ? old
          : old === 'codex-local\ndefault' && values.some((m) => m.configured)
            ? 'codex-local\n' + values.find((m) => m.configured).id
            : values[0]
              ? values[0].provider + '\n' + values[0].id
              : '',
      );
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadModels();
  }, []);
  useEffect(() => {
    if (graph.aiJob) setJob(graph.aiJob);
  }, [graph.aiJob?.id, graph.aiJob?.status]);
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api('execute', { action: 'graphAiStatus', jobId: job.id });
        if (stopped) return;
        setJob(next);
        if (!next || next.status !== 'running') await onRefresh();
      } catch (error) {
        if (!stopped) onError(error);
      }
    }, 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, running]);
  async function choose(value) {
    setRoute(value);
    localStorage.setItem('studyboard-graph-model', value);
    setBusy(true);
    try {
      const [provider, model] = value.split('\n');
      await api('execute', { action: 'graphSettings', provider, model });
      await onRefresh();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    try {
      const [provider, model] = route.split('\n');
      localStorage.setItem('studyboard-graph-model', route);
      setJob(await api('execute', { action: 'startGraphAi', provider, model, focus }));
      setSettingsOpen(false);
      await onRefresh();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sb-graph-ai sb-graph-ai-compact">
      <div className="sb-graph-ai-toolbar">
        <span>
          {report ? '已整理 · ' + (report.model || '模型') : '围绕核心问题提炼主干与分支'}
          {report?.reasoningEffort ? ' · ' + report.reasoningEffort : ''}
        </span>
        <B onClick={() => setSettingsOpen((v) => !v)}>{settingsOpen ? '收起设置' : '整理设置'}</B>
        <B
          primary
          disabled={
            !route || busy || running || loading || !graph.coverage?.sourceBlocks || !!selected?.unavailable
          }
          onClick={start}
        >
          {[2, 3].includes(report?.schemaVersion) ? '重新整理图谱' : 'AI整理图谱'}
        </B>
        {running && (
          <B
            onClick={() =>
              api('execute', { action: 'cancelGraphAi', jobId: job.id }).then(setJob).catch(onError)
            }
          >
            取消
          </B>
        )}
      </div>
      {(settingsOpen || !report) && (
        <div className="sb-graph-generation-settings">
          <div className="sb-graph-model-choice">
            <label>
              整理模型
              <select
                aria-label="知识图谱模型"
                value={route}
                disabled={running || loading || busy}
                onChange={(event) => choose(event.target.value)}
              >
                {models.map((m) => (
                  <option key={m.provider + m.id} value={m.provider + '\n' + m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="sb-icon" aria-label="刷新知识图谱模型" disabled={loading} onClick={loadModels}>
              ↻
            </button>
          </div>
          <label>
            这张图想回答什么（可选）
            <textarea
              aria-label="图谱核心问题"
              value={focus}
              disabled={running}
              maxLength={600}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="留空由 AI 根据材料主线概括；也可指定要解释的机制、比较或问题。"
            />
          </label>
          <p>
            主干先保留少量关键实体，细节放入必要分支。问题会在开始整理时保存；整理基于当前可用笔记，主题下拉用于切换浏览范围。
          </p>
        </div>
      )}
      {running && (
        <p role="status" className="sb-success-note">
          {job.phase} · {job.coverage?.sourceBlocks || 0} 段来源 · 已用时{' '}
          {Math.floor((Date.now() - Date.parse(job.createdAt)) / 60000)} 分钟
        </p>
      )}
      {['error', 'cancelled'].includes(job?.status) && (
        <p role="alert" className="sb-notice">
          {job.error || '图谱整理已取消'}
        </p>
      )}
      {graph.aiStale && (
        <p className="sb-notice">
          资料、所选版本或整理问题已有变化，当前保留上次整理的图谱。
          {graph.supersededSummaryCount > 0 &&
            `其中 ${graph.supersededSummaryCount} 个引用的总结已有新版本。`}
          {graph.invalidSourceCount > 0 &&
            `另有 ${graph.invalidSourceCount} 段来源已删除或改写，相应关系暂不显示。`}
          点击「重新整理图谱」后，才会根据当前选定的版本更新。
        </p>
      )}
      {report && settingsOpen && (
        <p className="sb-graph-report-meta">
          {report.createdAt ? new Date(report.createdAt).toLocaleString('zh-CN') : '历史图谱'} ·{' '}
          {graph.nodes.length} 个实体 · {graph.edges.length} 条完整关系
        </p>
      )}
    </section>
  );
}
