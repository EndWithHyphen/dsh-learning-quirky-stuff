import React, { useEffect, useRef, useState, useId } from 'react';
import { useLearning } from './context.jsx';
import { Action, Claim, ErrorNotice, ModelPicker, ReportStatus, TaskProgress, useTask } from './shared.jsx';
import { download, filename } from '../export.js';
import css from './weekly.css';
import WeeklyReview from './weekly-review.jsx';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const labels = {
  note: '新建笔记',
  summary: 'AI 总结',
  systemStudy: '系统学习',
  topics: '专题整理',
  explore: '拓展探索',
  preview: '材料预览',
  feedback: '理解反馈',
  studyEdit: '论证白板修改',
};
export default function WeeklyView({ context = {} }) {
  const learning = useLearning(),
    periodId = useId(),
    [timeZone, setTimeZone] = useState(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    ),
    [date, setDate] = useState(today),
    [overview, setOverview] = useState(null),
    [history, setHistory] = useState([]),
    [selected, setSelected] = useState(context.reportId || ''),
    [report, setReport] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [studyView, setStudyView] = useState('summary'),
    intent = useRef('summary'),
    reportRoot = useRef(),
    scrollRequested = useRef(false),
    alive = useRef(true),
    request = useRef(0),
    selectedRequest = useRef(0);
  const task = useTask(
    'weekly',
    (result, job) => {
      if (job?.key !== overview?.week.key) return;
      setStudyView(intent.current);
      scrollRequested.current = true;
      setSelected(result.reportId);
      setRefresh((v) => v + 1);
    },
    overview?.week.key || 'loading-week',
  );
  useEffect(() => {
    setStudyView('summary');
  }, [date, timeZone]);
  useEffect(() => {
    if (report?.value && scrollRequested.current) {
      scrollRequested.current = false;
      requestAnimationFrame(() => reportRoot.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }, [report?.id, studyView]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
      selectedRequest.current++;
    };
  }, []);
  useEffect(() => {
    const at = ++request.current;
    setLoading(true);
    setError('');
    Promise.all([
      learning.api('execute', { action: 'weekly.overview', date, timeZone }),
      learning.api('execute', { action: 'weekly.list' }),
    ])
      .then(([next, items]) => {
        if (at !== request.current || !alive.current) return;
        setOverview(next);
        setHistory(items);
        setSelected((old) =>
          items.some((r) => r.id === old && r.key === next.week.key && !r.deletedAt)
            ? old
            : items.find((r) => r.key === next.week.key && !r.deletedAt)?.id || '',
        );
      })
      .catch((e) => at === request.current && setError(e.message))
      .finally(() => at === request.current && setLoading(false));
  }, [date, timeZone, refresh]);
  useEffect(() => {
    const at = ++selectedRequest.current;
    setReport(null);
    if (!selected) return;
    learning
      .api('execute', { action: 'weekly.get', id: selected })
      .then((value) => {
        if (at === selectedRequest.current && alive.current) setReport(value);
      })
      .catch((e) => at === selectedRequest.current && setError(e.message));
  }, [selected]);
  useEffect(() => {
    if (!context.reportId) return;
    learning
      .api('execute', { action: 'weekly.get', id: context.reportId })
      .then((value) => {
        if (alive.current && value.value) {
          setTimeZone(value.value.week.timeZone);
          setDate(value.value.week.startDate);
          setSelected(value.id);
        }
      })
      .catch((e) => setError(e.message));
  }, [context.reportId]);
  function shift(amount) {
    const next = new Date((overview?.week.startDate || date) + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + amount * 7);
    setDate(next.toISOString().slice(0, 10));
  }
  async function deleted(id, value) {
    try {
      await learning.api('execute', { action: 'weekly.deleted', id, deleted: value });
      setSelected(value ? '' : id);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e.message);
    }
  }
  function openStudy(view) {
    setStudyView(view);
    requestAnimationFrame(() => reportRoot.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  function generate(view = 'summary') {
    intent.current = view;
    return task.start({ action: 'weekly.generate', date: overview.week.startDate, timeZone });
  }
  function exportReport() {
    const value = report?.value;
    if (!value) return;
    const sources = new Map(),
      lines = [
        `# ${value.title}`,
        '',
        `${value.week.startDate} ～ ${value.week.endDate} · ${value.week.timeZone}`,
        `生成时间：${new Date(report.createdAt).toLocaleString('zh-CN', { timeZone: value.week.timeZone })}（以下统计截至生成时）`,
        '',
        `新建笔记：${value.stats.newNotes}；AI 整理：${value.stats.summaries + value.stats.analyses}；复习：${value.stats.reviews} 次、${value.stats.reviewCards} 张卡、${value.stats.reviewDays} 天。`,
        '',
        value.note,
        '',
      ];
    const claim = (c) => {
      const refs = c.evidence.map((s) => {
        if (!sources.has(s.id)) sources.set(s.id, s);
        return [...sources.keys()].indexOf(s.id) + 1;
      });
      lines.push(c.text + ' ' + refs.map((n) => `[${n}]`).join(' '), '');
    };
    if (value.knowledgeSummary) {
      lines.push('## 本周知识总结', '');
      claim(value.knowledgeSummary.mainline);
      for (const point of value.knowledgeSummary.points) {
        lines.push('### ' + point.title, '');
        claim(point.explanation);
      }
      lines.push('## 学习进展回顾', '');
    }
    claim(value.overview);
    for (const item of value.themes) {
      lines.push('## ' + item.title, '');
      claim(item.progress);
    }
    if (value.changes.length) {
      lines.push('## 理解的变化', '');
      value.changes.forEach(claim);
    }
    if (value.connections.length) {
      lines.push('## 本周串起的联系', '');
      value.connections.forEach(claim);
    }
    if (value.nextWeek.length) {
      lines.push('## 下周重点', '');
      for (const item of value.nextWeek) {
        lines.push('### ' + item.focus, '');
        claim(item.reason);
      }
    }
    if (value.reviewQuestions?.length) {
      lines.push('## 本周复习', '');
      for (const [index, question] of value.reviewQuestions.entries()) {
        lines.push(
          `### ${index + 1}. ${question.prompt}`,
          '',
          question.context || '',
          ...(question.tasks || []).map((item) => '- ' + item),
          '',
          '<details><summary>参考答案</summary>',
          '',
        );
        claim({ text: question.answer, evidence: question.evidence });
        lines.push('</details>', '');
      }
    }
    lines.push('## 来源', '');
    let i = 0;
    for (const s of sources.values())
      lines.push(`[${++i}] ${s.title}${s.url ? ' — ' + s.url : '（本机学习记录）'}`);
    download(
      new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }),
      filename(value.week.startDate + '-学习周报', 'md'),
    );
  }
  const value = report?.value,
    stats = overview?.stats;
  return (
    <section className="sb-module-page sb-weekly">
      <style>{css}</style>
      <header className="sb-module-header">
        <h1>学习周报</h1>
        <p>总结本周的知识主线，回忆关键机制与联系，再选择下周值得继续的问题。</p>
      </header>
      <div className="sb-weekly-period">
        <label htmlFor={periodId}>周次</label>
        <div className="sb-weekly-weeknav" role="group" aria-label="选择周次">
          <Action onClick={() => shift(-1)}>上一周</Action>
          <input
            id={periodId}
            aria-label="周报日期"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Action onClick={() => shift(1)}>下一周</Action>
        </div>
        <Action
          onClick={() => {
            setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
            setDate(today());
          }}
        >
          回到本周
        </Action>
        <Action onClick={() => setRefresh((v) => v + 1)}>刷新记录</Action>
      </div>
      <ErrorNotice error={error} />
      {loading && (
        <p role="status" className="sb-muted">
          正在读取这一周的记录…
        </p>
      )}
      {overview && (
        <>
          <h2>
            {overview.week.startDate} ～ {overview.week.endDate}
            <small>
              {overview.week.inProgress ? ' · 本周进行中' : overview.week.future ? ' · 尚未开始' : ''}
            </small>
          </h2>
          <p className="sb-muted">
            周一至周日 · {overview.week.timeZone} · 日期选择器可选择这一周中的任意一天。
          </p>
          <div className="sb-weekly-stats">
            {[
              ['新建笔记', stats.newNotes],
              ['AI 整理', stats.summaries + stats.analyses],
              ['复习次数', stats.reviews],
              ['复习卡片', stats.reviewCards],
              ['复习天数', stats.reviewDays],
            ].map(([name, count]) => (
              <div key={name}>
                <strong>{count}</strong>
                <span>{name}</span>
              </div>
            ))}
          </div>
          {stats.reviews > 0 && (
            <p className="sb-weekly-rating">
              复习自评：忘记 {stats.ratings.again} · 困难 {stats.ratings.hard} · 记得 {stats.ratings.good} ·
              轻松 {stats.ratings.easy}
            </p>
          )}
          <p className="sb-muted">{overview.note}</p>
          {overview.incompleteNotes > 0 && (
            <p className="sb-notice">
              有 {overview.incompleteNotes} 篇笔记暂时无法读取，本次统计可能不完整。
            </p>
          )}
          <div className="sb-weekly-generate">
            <ModelPicker feature="weekly" />
            <Action
              primary
              disabled={
                loading ||
                task.busy ||
                (!value?.knowledgeSummary && !overview.sourceCount) ||
                overview.week.future
              }
              onClick={() => (value?.knowledgeSummary ? openStudy('summary') : generate('summary'))}
            >
              {value?.knowledgeSummary ? '查看本周总结' : '生成本周总结'}
            </Action>
            <Action
              disabled={
                loading ||
                task.busy ||
                (!value?.reviewQuestions?.length && !overview.sourceCount) ||
                overview.week.future
              }
              onClick={() => (value?.reviewQuestions?.length ? openStudy('review') : generate('review'))}
            >
              复习本周
            </Action>
          </div>
          {!overview.sourceCount && !loading && (
            <p className="sb-muted">
              这一周还没有可用于回顾的正文、总结或复习记录。记录学习内容后再生成，也可以切换周次。
            </p>
          )}
          <TaskProgress controller={task} />
          {overview.activities.length > 0 && (
            <details className="sb-weekly-activities">
              <summary>查看本周最近的记录 · {overview.activities.length} 项</summary>
              {overview.activities.map((item, i) => (
                <button key={i} onClick={() => learning.navigation.current.openSource?.(item)}>
                  <span>{labels[item.kind] || '学习记录'}</span>
                  <strong>{item.title}</strong>
                  <small>
                    {new Date(item.at).toLocaleDateString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      timeZone,
                    })}
                  </small>
                </button>
              ))}
            </details>
          )}
        </>
      )}
      {history.some((r) => !r.deletedAt) && (
        <label className="sb-weekly-history">
          历史周报
          <select
            aria-label="选择历史周报"
            value={selected}
            onChange={(e) => {
              const item = history.find((r) => r.id === e.target.value);
              setSelected(e.target.value);
              if (item) {
                setTimeZone(item.week.timeZone);
                setDate(item.week.startDate);
              }
            }}
          >
            <option value="">选择已保存的周报</option>
            {history
              .filter((r) => !r.deletedAt)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.week.startDate} · {r.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {report && <ReportStatus report={report} />}
      {value && (
        <article className="sb-weekly-report" ref={reportRoot}>
          <header>
            <h2>{value.title}</h2>
            <div>
              <Action
                disabled={loading || task.busy || !overview?.sourceCount}
                onClick={() => generate('summary')}
              >
                重新总结
              </Action>
              <Action onClick={exportReport}>下载周报</Action>
              <Action onClick={() => deleted(report.id, true)}>删除这份周报</Action>
            </div>
          </header>
          <nav className="sb-weekly-study-tabs" aria-label="周报学习视图">
            <Action
              primary={studyView === 'summary'}
              aria-pressed={studyView === 'summary'}
              onClick={() => setStudyView('summary')}
            >
              本周总结
            </Action>
            <Action
              primary={studyView === 'review'}
              aria-pressed={studyView === 'review'}
              onClick={() => setStudyView('review')}
            >
              本周复习{value.reviewQuestions?.length ? ' · ' + value.reviewQuestions.length : ''}
            </Action>
          </nav>
          {studyView === 'review' ? (
            value.reviewQuestions?.length ? (
              <WeeklyReview key={report.id} report={report} onChanged={() => setRefresh((n) => n + 1)} />
            ) : (
              <div className="sb-weekly-legacy">
                <p>这份旧周报还没有复习题。生成本周总结会一起补充知识总结与复习题。</p>
                <Action
                  primary
                  disabled={task.busy || !overview?.sourceCount}
                  onClick={() => generate('review')}
                >
                  生成本周复习
                </Action>
              </div>
            )
          ) : (
            <>
              {value.knowledgeSummary ? (
                <section className="sb-weekly-knowledge">
                  <h3>本周知识总结</h3>
                  <Claim value={value.knowledgeSummary.mainline} />
                  {value.knowledgeSummary.points.map((point, i) => (
                    <div key={i}>
                      <h4>{point.title}</h4>
                      <Claim value={point.explanation} />
                    </div>
                  ))}
                </section>
              ) : (
                <p className="sb-muted">
                  这份旧周报保留了学习进展回顾，可点击「生成本周总结」补充知识总结与复习题。
                </p>
              )}
              <section className="sb-weekly-progress">
                <h3>学习进展回顾</h3>
                <Claim value={value.overview} />
                <p className="sb-muted">周报正文依据生成时的记录；上方统计会随刷新更新。</p>
                {value.themes.map((item, i) => (
                  <section key={i}>
                    <h3>{item.title}</h3>
                    <Claim value={item.progress} />
                  </section>
                ))}
                {value.changes.length > 0 && (
                  <section>
                    <h3>理解的变化</h3>
                    {value.changes.map((item, i) => (
                      <Claim key={i} value={item} />
                    ))}
                  </section>
                )}
                {value.connections.length > 0 && (
                  <section>
                    <h3>本周串起的联系</h3>
                    {value.connections.map((item, i) => (
                      <Claim key={i} value={item} />
                    ))}
                  </section>
                )}
                {value.nextWeek.length > 0 && (
                  <section>
                    <h3>下周值得继续的重点</h3>
                    {value.nextWeek.map((item, i) => (
                      <div key={i}>
                        <h4>{item.focus}</h4>
                        <Claim value={item.reason} />
                      </div>
                    ))}
                  </section>
                )}
              </section>
            </>
          )}
        </article>
      )}
      {history.some((r) => r.deletedAt) && (
        <details className="sb-weekly-trash">
          <summary>已删除的周报</summary>
          {history
            .filter((r) => r.deletedAt)
            .map((r) => (
              <div key={r.id}>
                <span>
                  {r.week.startDate} · {r.title}
                </span>
                <Action onClick={() => deleted(r.id, false)}>恢复</Action>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
