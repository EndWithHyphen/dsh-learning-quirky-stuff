import React, { useEffect, useState } from 'react';
import { useLearning } from './context.jsx';
import {
  Action,
  displayText,
  Claim,
  Evidence,
  ErrorNotice,
  ModelPicker,
  ReportStatus,
  TaskProgress,
  useTask,
} from './shared.jsx';
import { highlightText } from './source-focus.js';

const directions = { foundation: '相关基础', perspective: '不同视角', transfer: '跨领域联系' };
export default function ExploreView({ context = {} }) {
  const learning = useLearning(),
    [focus, setFocus] = useState(context.focus || ''),
    [goal, setGoal] = useState(''),
    [mode, setMode] = useState('web'),
    [report, setReport] = useState(null),
    [history, setHistory] = useState([]),
    [queue, setQueue] = useState([]),
    [error, setError] = useState('');
  const refresh = async () => {
    setHistory(await learning.api('execute', { action: 'explore.history' }));
    setQueue(await learning.api('execute', { action: 'explore.queue' }));
  };
  const openReport = async (id) => setReport(await learning.api('execute', { action: 'explore.report', id }));
  const task = useTask('explore', async (result) => {
    await openReport(result.reportId);
    await refresh();
  });
  useEffect(() => {
    refresh().catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    if (context.focus) setFocus(context.focus);
  }, [context.focus]);
  useEffect(() => {
    if (context.reportId) openReport(context.reportId).catch((error) => setError(error.message));
  }, [context.reportId]);
  useEffect(() => {
    if (report?.id === context.reportId)
      requestAnimationFrame(() =>
        highlightText(document.querySelector('.sb-module-report'), context.textQuote),
      );
  }, [report?.id, context.reportId, context.textQuote]);
  async function add(item) {
    try {
      await learning.api('execute', {
        action: 'explore.add',
        reportId: report.id,
        recommendationId: item.id,
      });
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }
  async function state(item, state) {
    try {
      await learning.api('execute', { action: 'explore.update', id: item.id, state });
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <section className="sb-module-page">
      <header className="sb-module-header">
        <h1>拓展探索</h1>
        <p>从当前主题向外拓展，了解联系、增量价值和适用边界。</p>
      </header>
      <ErrorNotice error={error} />
      <div className="sb-module-form">
        <label>
          想拓展什么
          <input
            aria-label="探索主题"
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="输入一个主题、机制或仍未想清楚的问题"
            maxLength={300}
          />
        </label>
        <label>
          更想了解的方向
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如：不同解释、前置理论、在另一个领域的应用"
            maxLength={1200}
          />
        </label>
        <div className="sb-module-inline">
          <label>
            资料范围
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="web">联网寻找资料</option>
              <option value="library">关联我的笔记</option>
            </select>
          </label>
          <ModelPicker feature="explore" />
        </div>
        {mode === 'web' && <p className="sb-muted">联网检索使用本机 Codex，读取资料正文后再生成建议。</p>}
        <Action
          primary
          disabled={!focus.trim() || task.busy}
          onClick={() => task.start({ action: 'explore.start', focus, goal, mode })}
        >
          开始探索
        </Action>
      </div>
      <TaskProgress controller={task} />
      {history.length > 0 && (
        <label className="sb-module-history">
          探索记录
          <select
            aria-label="探索记录"
            value={report?.id || ''}
            onChange={(event) =>
              event.target.value
                ? openReport(event.target.value).catch((error) => setError(error.message))
                : setReport(null)
            }
          >
            <option value="">选择记录</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
      )}
      <ReportStatus report={report} />
      {report?.value && (
        <section className="sb-module-report">
          <h2>{report.value.focus}</h2>
          <p>{displayText(report.value.overview)}</p>
          <div className="sb-explore-grid">
            {report.value.recommendations.map((item) => (
              <article key={item.id}>
                <span className="sb-module-badge">{directions[item.direction]}</span>
                <h2>{item.topic}</h2>
                <Claim value={item.connection} />
                <h3>能获得什么</h3>
                <p>{item.gain}</p>
                {item.prerequisites.length > 0 && (
                  <p className="sb-muted">相关基础：{item.prerequisites.join('、')}</p>
                )}
                {item.boundaries && <p className="sb-module-boundary">{item.boundaries}</p>}
                <p className="sb-muted">预计学习 {item.estimatedMinutes} 分钟</p>
                <Evidence sources={item.sources} />
                <Action
                  onClick={() => add(item)}
                  disabled={queue.some(
                    (entry) => entry.reportId === report.id && entry.recommendationId === item.id,
                  )}
                >
                  加入待学
                </Action>
              </article>
            ))}
          </div>
          {report.value.failures.length > 0 && (
            <details className="sb-module-muted">
              <summary>有 {report.value.failures.length} 个来源未能读取</summary>
              {report.value.failures.map((failure, index) => (
                <p key={index}>
                  {failure.url}：{failure.message}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
      <section className="sb-module-report">
        <h2>我的待学清单</h2>
        {queue
          .filter((item) => item.state !== 'archived')
          .map((item) => (
            <article className="sb-learning-queue-item" key={item.id}>
              <div>
                <h3>{item.title}</h3>
                <p>{item.gain}</p>
                <Evidence sources={item.sources} />
              </div>
              <label>
                状态
                <select
                  aria-label={'学习状态：' + item.title}
                  value={item.state}
                  onChange={(event) => state(item, event.target.value)}
                >
                  <option value="planned">待学</option>
                  <option value="learning">学习中</option>
                  <option value="completed">已学</option>
                  <option value="archived">归档</option>
                </select>
              </label>
            </article>
          ))}
        {!queue.some((item) => item.state !== 'archived') && (
          <p className="sb-muted">从推荐中选择值得继续学的内容，放进这里。</p>
        )}
      </section>
    </section>
  );
}
