import React, { useEffect, useRef, useState } from 'react';
import { useLearning } from './features/context.jsx';
import {
  Action,
  Evidence,
  ErrorNotice,
  ReportStatus,
  TaskProgress,
  useTask,
  date,
} from './features/shared.jsx';
import SystemStudyCanvas from './system-study-canvas.jsx';
import { STUDY_FORMAT_NAMES, STUDY_ORIGIN_NAMES } from './system-study-layout.js';
import css from './system-study.css';

export default function SystemStudyPanel({
  board,
  api,
  models,
  route,
  chooseRoute,
  reloadModels,
  onGenerate,
  onClose,
  onSwitch,
  onError,
  onToast,
  initialReportId,
}) {
  const learning = useLearning(),
    mounted = useRef(true),
    loadSequence = useRef(0),
    [history, setHistory] = useState([]),
    [active, setActive] = useState(initialReportId || ''),
    [result, setResult] = useState(null),
    [form, setForm] = useState(!initialReportId),
    [focus, setFocus] = useState(''),
    [goal, setGoal] = useState(''),
    [scope, setScope] = useState('board'),
    [includeHistory, setIncludeHistory] = useState(true),
    [related, setRelated] = useState(true),
    [web, setWeb] = useState(route.startsWith('codex-local\n')),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [canvasEpoch, setCanvasEpoch] = useState(0);
  const controller = useTask(
    'systemStudy',
    async (value) => {
      await refresh();
      if (mounted.current) {
        setActive(value.reportId);
        setForm(false);
      }
    },
    board.id,
  );
  const selectedModel = models.find((model) => model.provider + '\n' + model.id === route);
  async function refresh() {
    const values = await api('execute', { action: 'systemStudy.list', noteId: board.id });
    if (mounted.current) setHistory(values);
    return values;
  }
  useEffect(() => {
    mounted.current = true;
    refresh()
      .then((values) => {
        if (!mounted.current || initialReportId) return;
        const first = values.find((item) => !item.deletedAt);
        if (first) {
          setActive(first.id);
          setForm(false);
        }
      })
      .catch((e) => mounted.current && setError(e.message));
    return () => {
      mounted.current = false;
      loadSequence.current++;
    };
  }, [board.id]);
  useEffect(() => {
    const at = ++loadSequence.current;
    setResult(null);
    if (!active) return;
    setLoading(true);
    setError('');
    api('execute', { action: 'systemStudy.get', id: active })
      .then((value) => {
        if (at !== loadSequence.current || !mounted.current) return;
        setResult(value);
      })
      .catch((e) => at === loadSequence.current && setError(e.message))
      .finally(() => at === loadSequence.current && setLoading(false));
  }, [active, canvasEpoch]);
  async function generate() {
    const [provider, model] = route.split('\n');
    await controller.start(() =>
      onGenerate({
        mode: 'systemStudy',
        provider,
        model,
        scope,
        focus,
        goal,
        history: includeHistory,
        related,
        web: web && provider === 'codex-local',
        useImages: selectedModel?.vision !== false,
      }),
    );
  }
  async function setDeleted(id, deleted) {
    try {
      await api('execute', { action: 'systemStudy.deleted', id, deleted });
      const items = await refresh();
      setActive(deleted ? items.find((item) => !item.deletedAt)?.id || '' : id);
      setForm(!items.some((item) => !item.deletedAt));
      onToast(deleted ? '系统学习结果已删除，可恢复' : '系统学习结果已恢复');
    } catch (e) {
      setError(e.message);
    }
  }
  async function enroll(index) {
    try {
      const value = await api('execute', { action: 'systemStudy.enroll', id: active, index });
      onToast(value.added ? '已加入复习' : '已在复习队列中');
    } catch (e) {
      onError(e);
    }
  }
  const report = result?.report,
    value = report?.value,
    available = value && !report.unavailable;
  if (!learning.enabled('systemStudy')) return null;
  return (
    <aside className="sb-summary sb-study-panel sb-study-expanded sb-system-panel">
      <style>{css}</style>
      <header>
        <h2>AI总结</h2>
        <button className="sb-icon" aria-label="关闭系统学习" onClick={onClose}>
          ×
        </button>
      </header>
      <nav className="sb-system-tabs" aria-label="学习模式">
        <Action onClick={onSwitch}>材料总结</Action>
        <Action primary aria-current="page">
          系统学习
        </Action>
      </nav>
      <div className="sb-study-scroll">
        <div className="sb-system-inner">
          <div className="sb-system-topbar">
            <select aria-label="选择系统学习结果" value={active} onChange={(e) => setActive(e.target.value)}>
              {!active && <option value="">暂无系统学习结果</option>}
              {history
                .filter((item) => !item.deletedAt)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {date(item.createdAt)}
                  </option>
                ))}
            </select>
            <Action onClick={() => setForm((v) => !v)}>{form ? '收起生成设置' : '生成新的系统学习'}</Action>
          </div>
          {form && (
            <section className="sb-system-form">
              <div>
                <h3>围绕一个主题，建立可修改的解释</h3>
                <p className="sb-muted">
                  先分析内容，再选择适合的图形与论证结构。扩展资料、模型推断和原材料保留各自来源。
                </p>
              </div>
              <div className="sb-system-form-grid">
                <label>
                  模型
                  <div className="sb-system-model">
                    <select
                      aria-label="系统学习模型"
                      value={route}
                      onChange={(e) => chooseRoute(e.target.value)}
                      disabled={controller.busy}
                    >
                      {models.map((model) => (
                        <option key={model.provider + model.id} value={model.provider + '\n' + model.id}>
                          {model.name}
                          {!model.vision ? ' · 文字' : ''}
                        </option>
                      ))}
                    </select>
                    <button className="sb-icon" aria-label="刷新系统学习模型" onClick={reloadModels}>
                      ↻
                    </button>
                  </div>
                </label>
                <label>
                  材料范围
                  <select
                    aria-label="系统学习材料范围"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <option value="board">整篇笔记</option>
                    <option value="selection">当前选中区域</option>
                  </select>
                </label>
              </div>
              <label>
                学习主题
                <input
                  aria-label="系统学习主题"
                  value={focus}
                  maxLength={300}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="留空时从材料提炼；也可以指定你真正想理解的问题"
                />
              </label>
              <label>
                学习目标
                <textarea
                  aria-label="系统学习目标"
                  value={goal}
                  maxLength={2500}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="例如：补足关键背景，比较不同解释，说明结论的成立条件"
                  rows={2}
                />
              </label>
              <div className="sb-system-options">
                <label>
                  <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} />
                  连接相关笔记
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={includeHistory}
                    onChange={(e) => setIncludeHistory(e.target.checked)}
                  />
                  时间旅行研究
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={web && selectedModel?.provider === 'codex-local'}
                    disabled={selectedModel?.provider !== 'codex-local'}
                    onChange={(e) => setWeb(e.target.checked)}
                  />
                  联网扩展资料
                </label>
              </div>
              <p className="sb-muted">
                {selectedModel?.provider === 'codex-local'
                  ? '联网时会检索并读取扩展资料正文；未能核实的内容会单独标注。'
                  : '此模型使用已有资料。联网扩展可选择本机 Codex；模型补充会标注为未核实。'}
              </p>
              {includeHistory && (
                <p className="sb-muted">
                  时间旅行研究追踪“当时的问题与知识 → 当时的解释 → 后来的修正”，按主题选取有意义的阶段。
                </p>
              )}
              <Action
                primary
                disabled={!route || controller.busy || selectedModel?.unavailable}
                onClick={generate}
              >
                生成系统学习白板
              </Action>
            </section>
          )}
          <TaskProgress controller={controller} />
          <ErrorNotice error={error} />
          {loading && (
            <p className="sb-muted" role="status">
              正在读取系统学习白板…
            </p>
          )}
          {report && <ReportStatus report={report} />}
          {available && (
            <>
              <header className="sb-system-title">
                <div>
                  <span className="sb-eyebrow">SYSTEM STUDY / 系统学习</span>
                  <h1>{value.title}</h1>
                  <p>{value.question}</p>
                </div>
                <Action onClick={() => setDeleted(report.id, true)}>删除这次结果</Action>
              </header>
              <p className="sb-system-overview">{value.overview}</p>
              <details className="sb-system-strategy">
                <summary>本次为什么这样组织</summary>
                <p>{value.plan.rationale}</p>
                {value.boards.map((view) => (
                  <p key={view.id}>
                    <strong>
                      {view.title} · {STUDY_FORMAT_NAMES[view.format]}
                    </strong>
                    ：{view.rationale}
                  </p>
                ))}
              </details>
              {value.failures?.length > 0 && (
                <details className="sb-system-strategy">
                  <summary>有 {value.failures.length} 项资料未能完整读取</summary>
                  {value.failures.map((item, i) => (
                    <p key={i}>{item.message}</p>
                  ))}
                </details>
              )}
              <SystemStudyCanvas
                key={report.id + ':' + canvasEpoch}
                report={report}
                saved={result.canvas}
                api={api}
                onError={onError}
                onReload={() => setCanvasEpoch((v) => v + 1)}
              />
              {!value.history.applicable && <p className="sb-muted">时间旅行研究：{value.history.reason}</p>}
              {value.nextSteps.length > 0 && (
                <section className="sb-system-next">
                  <h3>沿着问题继续研究</h3>
                  {value.nextSteps.map((step, i) => (
                    <article key={i}>
                      <h4>{step.question}</h4>
                      <p>{step.why}</p>
                      <Evidence sources={step.sources} />
                    </article>
                  ))}
                </section>
              )}
              <section className="sb-system-review">
                <h3>自测与复习</h3>
                <p className="sb-muted">先尝试解释，再展开参考答案；按需加入复习。</p>
                {value.reviewQuestions.map((question, index) => (
                  <article key={index}>
                    <h4>
                      {index + 1}. {question.prompt}
                    </h4>
                    <details>
                      <summary>查看参考答案</summary>
                      <p>{question.answer}</p>
                      <small>{STUDY_ORIGIN_NAMES[question.origin]}</small>
                      <Evidence sources={question.evidence} />
                    </details>
                    <Action onClick={() => enroll(index)}>加入复习</Action>
                  </article>
                ))}
              </section>
            </>
          )}
          {!available && !loading && !controller.busy && !form && (
            <p className="sb-muted">选择已有结果，或生成一张围绕主题展开的系统学习白板。</p>
          )}
          {history.some((item) => item.deletedAt) && (
            <details className="sb-system-trash">
              <summary>已删除的系统学习结果</summary>
              {history
                .filter((item) => item.deletedAt)
                .map((item) => (
                  <div key={item.id}>
                    <span>{item.title}</span>
                    <Action onClick={() => setDeleted(item.id, false)}>恢复</Action>
                  </div>
                ))}
            </details>
          )}
        </div>
      </div>
    </aside>
  );
}
