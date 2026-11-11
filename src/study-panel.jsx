import React, { useEffect, useMemo, useRef, useState, useId } from 'react';
import { legacyStudy } from '../study-schema.js';
import { diagramLayout, diagramLines } from './diagram-layout.js';
import SourceFigure from './source-figure.jsx';
import { useLearning } from './features/context.jsx';
import { highlightText } from './features/source-focus.js';
import { useSummaryInfographics, InfographicRegion } from './infographic-panel.jsx';
const SystemStudyPanel = React.lazy(() => import('./system-study-panel.jsx'));

const B = ({ children, primary = false, ...p }) => (
  <button {...p} className={`sb-button ${primary ? 'sb-primary' : ''} ${p.className || ''}`}>
    {children}
  </button>
);
const date = (s) =>
  new Date(s).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AnnotatedText({ text = '', blockId, summary, boardId, api, onChange, onError }) {
  const ref = useRef(),
    [selection, setSelection] = useState(null),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false);
  const annotations = (summary.annotations || []).filter((a) => a.blockId === blockId);
  const marks = annotations.filter((a) => a.end > a.start),
    points = [...new Set([0, text.length, ...marks.flatMap((a) => [a.start, a.end])])].sort((a, b) => a - b);
  function capture() {
    if (draft) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    if (!ref.current?.contains(range.startContainer) || !ref.current.contains(range.endContainer)) return;
    const before = range.cloneRange();
    before.selectNodeContents(ref.current);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length,
      end = start + range.toString().length;
    if (end > start && end <= text.length) setSelection({ start, end, quote: text.slice(start, end) });
  }
  function edit(value) {
    setDraft({ ...value, note: value.note || '' });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await api('execute', {
        action: 'annotate',
        id: boardId,
        summaryId: summary.id,
        blockId,
        start: draft.start,
        end: draft.end,
        quote: draft.quote,
        kind: 'underline',
        note: draft.note.trim(),
        ...(draft.id ? { annotationId: draft.id } : {}),
      });
      onChange(result.annotations);
      setSelection(null);
      setDraft(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    try {
      const r = await api('execute', { action: 'annotate', id: boardId, summaryId: summary.id, remove: id });
      onChange(r.annotations);
    } catch (e) {
      onError(e);
    }
  }
  return (
    <div className="sb-annotated">
      <div
        ref={ref}
        className="sb-readable-text"
        data-study-block={blockId}
        onMouseUp={capture}
        onKeyUp={capture}
      >
        {points.slice(0, -1).map((start, i) => {
          const end = points[i + 1],
            active = marks.filter((a) => a.start <= start && a.end >= end);
          return (
            <span
              key={start}
              className={active.length ? 'sb-underline' : ''}
              title={active
                .map((a) => a.note)
                .filter(Boolean)
                .join('\n')}
            >
              {text.slice(start, end)}
            </span>
          );
        })}
      </div>
      {selection && !draft && (
        <div className="sb-selection-tools" role="toolbar" aria-label="文字划线">
          <span>已选 {selection.quote.length} 字</span>
          <B disabled={busy} onClick={() => edit(selection)}>
            划线
          </B>
          <button className="sb-icon" aria-label="取消选择" onClick={() => setSelection(null)}>
            ×
          </button>
        </div>
      )}
      {draft && (
        <div
          className="sb-note-editor"
          role="dialog"
          aria-label="划线备注"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              e.stopPropagation();
              setDraft(null);
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
              e.preventDefault();
              save();
            }
          }}
        >
          {draft.quote && <blockquote>{draft.quote.slice(0, 200)}</blockquote>}
          <label>
            备注（可选）
            <textarea
              autoFocus
              value={draft.note}
              maxLength={6000}
              aria-label="备注（可选）"
              placeholder="可留空，直接保存划线；也可以写下你的理解或疑问。"
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <div>
            <B disabled={busy} onClick={() => setDraft(null)}>
              取消
            </B>
            <B primary disabled={busy || (draft.start === draft.end && !draft.note.trim())} onClick={save}>
              {draft.note.trim() ? '保存划线与备注' : '保存划线'}
            </B>
          </div>
        </div>
      )}
      {annotations
        .filter((a) => a.note)
        .map((a) => (
          <div className="sb-saved-note" key={a.id}>
            {a.quote && <blockquote>{a.quote}</blockquote>}
            <p>{a.note}</p>
            <div>
              <small>{date(a.createdAt)}</small>
              <button onClick={() => edit(a)}>编辑</button>
              <button onClick={() => remove(a.id)}>删除</button>
            </div>
          </div>
        ))}
      {marks.some((a) => !a.note) && (
        <details className="sb-mark-list">
          <summary>划线 {marks.filter((a) => !a.note).length}</summary>
          {marks
            .filter((a) => !a.note)
            .map((a) => (
              <div key={a.id}>
                <span>{a.quote.slice(0, 50)}</span>
                <button onClick={() => edit(a)}>编辑备注</button>
                <button onClick={() => remove(a.id)}>移除</button>
              </div>
            ))}
        </details>
      )}
    </div>
  );
}

export function StudyDiagram({ diagram }) {
  const marker = useId().replace(/:/g, ''),
    layout = diagramLayout(diagram),
    byId = new Map(layout.nodes.map((n) => [n.id, n]));
  function end(a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.min(
        (a.width / 2 + 4) / Math.max(0.01, Math.abs(dx)),
        (a.height / 2 + 4) / Math.max(0.01, Math.abs(dy)),
      );
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  return (
    <figure className="sb-study-diagram">
      <h4>{diagram.title}</h4>
      <svg viewBox={'0 0 ' + layout.width + ' ' + layout.height} role="img" aria-label={diagram.title}>
        <defs>
          <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8" fill="var(--sb-accent)" />
          </marker>
        </defs>
        {(diagram.edges || []).map((edge, i) => {
          const a = byId.get(edge.from),
            b = byId.get(edge.to);
          if (!a || !b) return null;
          const start = end(a, b),
            finish = end(b, a),
            cx = (start.x + finish.x) / 2,
            cy = (start.y + finish.y) / 2,
            labels = diagramLines(edge.label, 8);
          return (
            <g key={i}>
              <path
                d={'M' + start.x + ' ' + start.y + ' L' + finish.x + ' ' + finish.y}
                stroke="var(--sb-accent)"
                strokeOpacity=".65"
                strokeWidth="1.6"
                fill="none"
                markerEnd={'url(#' + marker + ')'}
              />
              {edge.label && (
                <>
                  <rect
                    x={cx - 56}
                    y={cy - labels.length * 9 - 5}
                    width="112"
                    height={labels.length * 18 + 10}
                    rx="5"
                    fill="var(--sb-bg)"
                  />
                  <text
                    x={cx}
                    y={cy - (labels.length - 1) * 9 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fill="var(--sb-muted)"
                  >
                    {labels.map((line, j) => (
                      <tspan key={j} x={cx} dy={j ? 18 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {layout.nodes.map((p) => {
          const labels = diagramLines(p.label, p.width === 200 ? 11 : 12);
          return (
            <g key={p.id}>
              <rect
                data-diagram-node="true"
                x={p.x - p.width / 2}
                y={p.y - p.height / 2}
                width={p.width}
                height={p.height}
                rx="12"
                fill="var(--sb-panel)"
                stroke="var(--sb-line)"
              />
              <text
                x={p.x}
                y={p.y - (labels.length - 1) * 12 + 6}
                textAnchor="middle"
                fill="var(--sb-ink)"
                fontSize="17"
                fontWeight="550"
              >
                {labels.map((line, j) => (
                  <tspan key={j} x={p.x} dy={j ? 24 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
              <title>{p.detail || p.label}</title>
            </g>
          );
        })}
      </svg>
      {diagram.nodes.some((n) => n.detail) && (
        <details className="sb-diagram-details">
          <summary>图中节点说明</summary>
          {diagram.nodes
            .filter((n) => n.detail)
            .map((n) => (
              <p key={n.id}>
                <strong>{n.label}</strong> · {n.detail}
              </p>
            ))}
        </details>
      )}
    </figure>
  );
}
export function QuestionCard({
  question,
  onEnroll,
  footer,
  renderAnswer,
  onFeedback,
  initialReveal = false,
}) {
  const [answer, setAnswer] = useState(''),
    [revealed, setRevealed] = useState(initialReveal),
    [hint, setHint] = useState(false);
  useEffect(() => {
    if (initialReveal) setRevealed(true);
  }, [initialReveal]);
  return (
    <div className="sb-question-card">
      <div className="sb-question-kind">
        <span>
          {{ recall: '主动回忆', apply: '应用练习', explain: '用自己的话讲清楚' }[question.kind] || '自测'}
        </span>
        {question.difficulty && (
          <span className="sb-question-level">
            {{ basic: '基础', intermediate: '进阶', advanced: '挑战' }[question.difficulty]}
          </span>
        )}
      </div>
      <h3>{question.prompt}</h3>
      {question.context && (
        <section className="sb-question-context">
          <h4>题干与条件</h4>
          <p>{question.context}</p>
        </section>
      )}
      {question.tasks?.length > 0 && (
        <section className="sb-question-tasks">
          <h4>作答任务</h4>
          <ol>
            {question.tasks.map((task, i) => (
              <li key={i}>{task}</li>
            ))}
          </ol>
        </section>
      )}
      <label className="sb-question-response">
        我的回答
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="先尝试自己回答，再揭晓答案。也可以在心里作答。"
          aria-label="我的回答"
          maxLength={8000}
        />
      </label>
      {hint && question.hint && <div className="sb-hint-box">{question.hint}</div>}
      <div className="sb-question-actions">
        {question.hint && !hint && <B onClick={() => setHint(true)}>给我一点提示</B>}
        <B primary onClick={() => setRevealed((v) => !v)}>
          {revealed ? '收起答案' : '揭晓答案'}
        </B>
        {onFeedback && (
          <B disabled={!answer.trim()} onClick={() => onFeedback(answer)}>
            获取理解反馈
          </B>
        )}
        {onEnroll && <B onClick={onEnroll}>将这道题加入复习</B>}
      </div>
      {revealed && (
        <div className="sb-answer">
          <span>参考答案</span>
          {renderAnswer ? renderAnswer(question) : <div className="sb-readable-text">{question.answer}</div>}
          {question.checkpoints?.length > 0 && (
            <section className="sb-answer-checkpoints">
              <h4>核对要点</h4>
              <ul>
                {question.checkpoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </section>
          )}
          {footer?.(answer)}
        </div>
      )}
    </div>
  );
}
export function Practice({
  questions,
  onEnroll,
  renderAnswer,
  concepts = [],
  onFeedback,
  initialQuestionId,
}) {
  const [index, setIndex] = useState(() =>
      Math.max(
        0,
        questions.findIndex((question) => question.id === initialQuestionId),
      ),
    ),
    [visited, setVisited] = useState(new Set());
  useEffect(() => {
    if (initialQuestionId) {
      const found = questions.findIndex((question) => question.id === initialQuestionId);
      if (found >= 0) setIndex(found);
    }
  }, [initialQuestionId]);
  if (!questions.length) return null;
  const q = questions[Math.min(index, questions.length - 1)];
  const go = (i) => {
    setVisited((v) => new Set([...v, index]));
    setIndex(i);
  };
  return (
    <section className="sb-practice">
      <div className="sb-section-title">
        <h3>自测与复习</h3>
        <span>
          {index + 1} / {questions.length}
        </span>
      </div>
      <div className="sb-practice-enroll">
        <p>先练习，再把需要巩固的题目加入复习。</p>
        <B onClick={() => onEnroll()}>全部加入复习 · {questions.length} 题</B>
      </div>
      <div className="sb-question-dots">
        {questions.map((v, i) => (
          <button
            key={v.id}
            className={i === index ? 'active' : visited.has(i) ? 'visited' : ''}
            onClick={() => go(i)}
            aria-label={`第 ${i + 1} 题`}
          />
        ))}
      </div>
      {q.conceptIds?.length > 0 && (
        <p className="sb-question-topics">
          对应知识点：
          {q.conceptIds
            .map((id) => concepts.find((c) => c.id === id)?.title)
            .filter(Boolean)
            .join('、')}
        </p>
      )}
      <QuestionCard
        key={q.id}
        question={q}
        initialReveal={q.id === initialQuestionId}
        onFeedback={onFeedback ? (answer) => onFeedback(q, answer) : null}
        onEnroll={() => onEnroll(q.id)}
        renderAnswer={renderAnswer}
      />
      <div className="sb-question-nav">
        <B disabled={index === 0} onClick={() => go(index - 1)}>
          上一题
        </B>
        <B disabled={index === questions.length - 1} onClick={() => go(index + 1)}>
          下一题
        </B>
      </div>
    </section>
  );
}
function ExpansionEditor({
  expand,
  setExpand,
  models,
  route,
  chooseRoute,
  running,
  busy,
  onGenerate,
  onOpen,
}) {
  return (
    <section className="sb-expand-composer" aria-label={`拓展 ${expand.concept.title}`}>
      <header>
        <h3>拓展：{expand.concept.title}</h3>
        <button className="sb-icon" aria-label="关闭主题拓展" onClick={() => setExpand(null)}>
          ×
        </button>
      </header>
      <blockquote className="sb-expand-context">{expand.concept.explanation.slice(0, 240)}</blockquote>
      {expand.result ? (
        <>
          <p className="sb-success-note">拓展已保存，原主题仍保留在这里。</p>
          <h4>{expand.result.study?.title || '主题拓展'}</h4>
          <p className="sb-readable-text">{expand.result.study?.overview}</p>
          <B primary onClick={() => onOpen(expand.result.id)}>
            查看完整拓展
          </B>
          <B onClick={() => setExpand({ ...expand, result: null })}>继续拓展</B>
        </>
      ) : (
        <>
          <div className="sb-expand-options">
            {['深入理解', '具体例子', '前置知识', '实际应用', '类比解释'].map((d) => (
              <button
                className={expand.direction === d ? 'active' : ''}
                key={d}
                onClick={() => setExpand({ ...expand, direction: d })}
              >
                {d}
              </button>
            ))}
          </div>
          <label>
            使用模型
            <select value={route} onChange={(e) => chooseRoute(e.target.value)}>
              {models.map((m) => (
                <option key={m.provider + m.id} value={`${m.provider}\n${m.id}`}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={expand.question}
            onChange={(e) => setExpand({ ...expand, question: e.target.value })}
            placeholder="围绕这个知识点，你想进一步了解什么？"
            aria-label="主题拓展问题"
          />
          <B primary disabled={busy || running || !route} onClick={onGenerate}>
            生成主题拓展
          </B>
          <p className="sb-muted">结果另存并关联原主题，完成后可在这里查看。</p>
        </>
      )}
    </section>
  );
}
export default function StudyPanel({
  board,
  api,
  onError,
  onToast,
  onGenerate,
  onAddCard,
  onClose,
  initialSummaryId,
  onSummaryChange,
  initialBlockId,
  sourceQuote,
  initialSystemStudyId,
}) {
  const moduleUI = useLearning(),
    sourceRoot = useRef();
  const [systemStudy, setSystemStudy] = useState(!!initialSystemStudyId),
    [summaries, setSummaries] = useState(board.summaries),
    [active, setActive] = useState(
      initialSummaryId || board.summaries.filter((s) => !s.deletedAt).at(-1)?.id || '',
    ),
    [models, setModels] = useState([]),
    [route, setRoute] = useState(localStorage.getItem('studyboard-model') || ''),
    [scope, setScope] = useState('board'),
    [instructions, setInstructions] = useState(''),
    [job, setJob] = useState(null),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(
      !!initialSummaryId || board.summaries.filter((s) => !s.deletedAt).at(-1)?.study?.version === 3,
    ),
    [generation, setGeneration] = useState(!board.summaries.some((s) => !s.deletedAt)),
    [expand, setExpand] = useState(null),
    [enrolled, setEnrolled] = useState('');
  const modelSelectId = useId(),
    [loadingModels, setLoadingModels] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deletedNotice, setDeletedNotice] = useState(null),
    deletedIds = useRef(new Set(board.summaries.filter((s) => s.deletedAt).map((s) => s.id)));
  useEffect(() => {
    setSummaries(board.summaries);
    deletedIds.current = new Set(board.summaries.filter((s) => s.deletedAt).map((s) => s.id));
  }, [board.summaries]);
  const visibleSummaries = summaries.filter((s) => !s.deletedAt),
    removedSummaries = summaries.filter((s) => s.deletedAt),
    summary = visibleSummaries.find((s) => s.id === active) || visibleSummaries.at(-1),
    study = summary && legacyStudy(summary);
  const infographicsEnabled = moduleUI.enabled('infographics');
  const infographics = useSummaryInfographics({
    api,
    noteId: board.id,
    summary,
    enabled: infographicsEnabled,
    onError,
    onToast,
  });
  const infographicProps = {
    controller: infographics,
    api,
    noteId: board.id,
    summaryId: summary?.id,
    route,
    models,
    chooseRoute,
    onError,
    onAddCard,
  };
  useEffect(() => {
    if (!initialBlockId || !study) return;
    let frame,
      tries = 0;
    const locate = () => {
      const target = [...(sourceRoot.current?.querySelectorAll('[data-study-block]') || [])].find(
        (node) => node.dataset.studyBlock === initialBlockId,
      );
      if (target) highlightText(target, sourceQuote);
      else if (tries++ < 30) frame = requestAnimationFrame(locate);
    };
    frame = requestAnimationFrame(locate);
    return () => cancelAnimationFrame(frame);
  }, [summary?.id, initialBlockId, sourceQuote]);
  function chooseRoute(value) {
    setRoute(value);
    localStorage.setItem('studyboard-model', value);
  }
  const reloadModels = async () => {
    setLoadingModels(true);
    try {
      const m = await api('models');
      setModels(m);
      setRoute((old) =>
        m.some((x) => `${x.provider}\n${x.id}` === old)
          ? old
          : old === 'codex-local\ndefault' && m.some((x) => x.provider === 'codex-local' && x.configured)
            ? 'codex-local\n' + m.find((x) => x.provider === 'codex-local' && x.configured).id
            : m[0]
              ? `${m[0].provider}\n${m[0].id}`
              : '',
      );
    } catch (e) {
      onError(e);
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => {
    reloadModels();
  }, []);
  useEffect(() => {
    let stopped = false;
    api('execute', { action: 'summaryTask', id: board.id })
      .then((j) => {
        if (stopped || !j) return;
        setJob(j);
        if (
          j.status === 'done' &&
          j.summary &&
          !j.summary.deletedAt &&
          !deletedIds.current.has(j.summary.id)
        ) {
          setSummaries((items) => (items.some((s) => s.id === j.summary.id) ? items : [...items, j.summary]));
          onSummaryChange?.(j.summary);
          if (!initialSummaryId && j.summary.kind !== 'expand') {
            setActive(j.summary.id);
            setGeneration(false);
          }
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [board.id]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let dead = false;
    const interval = setInterval(
      () =>
        api('summaryStatus', job.id)
          .then((j) => {
            if (dead) return;
            setJob(j);
            if (j.status === 'done' && !j.summary.deletedAt && !deletedIds.current.has(j.summary.id)) {
              setSummaries((s) => (s.some((v) => v.id === j.summary.id) ? s : [...s, j.summary]));
              onSummaryChange?.(j.summary);
              if (j.summary.kind === 'expand') {
                setExpand((current) => (current ? { ...current, result: j.summary } : current));
                onToast('主题拓展已保存');
              } else {
                setActive(j.summary.id);
                setGeneration(false);
                setExpanded(j.summary.study?.version === 3);
                setExpand(null);
              }
            }
          })
          .catch((e) => {
            if (!dead) {
              clearInterval(interval);
              onError(e);
            }
          }),
      1200,
    );
    return () => {
      dead = true;
      clearInterval(interval);
    };
  }, [job?.id, job?.status]);
  async function generate(mode = 'summary', extra = {}) {
    setBusy(true);
    try {
      const [provider, model] = route.split('\n');
      localStorage.setItem('studyboard-model', route);
      const j = await onGenerate({
        provider,
        model,
        scope,
        instructions,
        includeReview: true,
        mode,
        ...extra,
      });
      setJob(j);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  function annotations(values) {
    const updated = { ...summary, annotations: values };
    setSummaries((all) => all.map((s) => (s.id === summary.id ? updated : s)));
    onSummaryChange?.(updated);
  }
  async function changeDeleted(target, deleted) {
    setDeleting(true);
    try {
      const result = await api('execute', {
          action: 'setSummaryDeleted',
          id: board.id,
          summaryId: target.id,
          deleted,
        }),
        updated = result.summary;
      if (deleted) deletedIds.current.add(target.id);
      else deletedIds.current.delete(target.id);
      setSummaries((items) => items.map((s) => (s.id === target.id ? updated : s)));
      onSummaryChange?.(updated, result.meta);
      setExpand(null);
      setEnrolled('');
      if (deleted) {
        setDeletedNotice(updated);
        const next = visibleSummaries.filter((s) => s.id !== target.id).at(-1);
        setActive(next?.id || '');
        setGeneration(!next);
        if (job?.summary?.id === target.id) setJob(null);
      } else {
        setDeletedNotice(null);
        setActive(updated.id);
        setGeneration(false);
        setExpanded(updated.study?.version === 3);
      }
      onToast(deleted ? '总结已删除，可在已删除总结中恢复' : '总结已恢复');
    } catch (e) {
      onError(e);
    } finally {
      setDeleting(false);
    }
  }
  async function enroll(questionId) {
    try {
      const r = await api('execute', { action: 'enroll', id: board.id, summaryId: summary.id, questionId });
      const message = r.added
        ? `已加入 ${r.added} 张复习卡`
        : r.suspended
          ? `已有复习卡，其中 ${r.suspended} 张已设为不再出现，可在复习设置中恢复`
          : '已经在复习队列中';
      setEnrolled(message);
      onToast(message);
    } catch (e) {
      onError(e);
    }
  }
  const annotationProps = { summary, boardId: board.id, api, onChange: annotations, onError };
  const running = job?.status === 'running';
  const diagramBlock = (d) => (
    <section className="sb-diagram-section" key={d.id}>
      <StudyDiagram diagram={d} />
      {d.caption && (
        <AnnotatedText {...annotationProps} text={d.caption} blockId={'diagram:' + d.id + ':caption'} />
      )}
    </section>
  );
  const sourceBlock = (f) => (
    <SourceFigure
      key={f.id}
      figure={f}
      asset={summary?.assets?.[f.sourceId]}
      onSource={(reference) =>
        moduleUI.navigation.current.openSource?.({
          boardId: reference.noteId || board.id,
          locator: { pdf: reference },
        })
      }
      caption={
        f.caption && (
          <AnnotatedText {...annotationProps} text={f.caption} blockId={'figure:' + f.id + ':caption'} />
        )
      }
    />
  );
  const selectedModel = models.find((m) => m.provider + '\n' + m.id === route);

  if (systemStudy && moduleUI.enabled('systemStudy'))
    return (
      <React.Suspense
        fallback={
          <aside className="sb-summary sb-study-panel">
            <p>正在打开系统学习…</p>
          </aside>
        }
      >
        <SystemStudyPanel
          board={board}
          api={api}
          models={models}
          route={route}
          chooseRoute={chooseRoute}
          reloadModels={reloadModels}
          onGenerate={onGenerate}
          onClose={onClose}
          onSwitch={() => setSystemStudy(false)}
          onError={onError}
          onToast={onToast}
          initialReportId={initialSystemStudyId}
        />
      </React.Suspense>
    );

  return (
    <aside className={`sb-summary sb-study-panel ${expanded ? 'sb-study-expanded' : ''}`}>
      <header>
        <div>
          <h2>AI总结</h2>
          {summary && <small>{summary.kind === 'expand' ? '主题拓展' : 'AI 整理'}</small>}
        </div>
        <div>
          <button
            className="sb-icon"
            title={expanded ? '收起阅读视图' : '展开阅读视图'}
            aria-label={expanded ? '收起阅读视图' : '展开阅读视图'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '↙' : '↗'}
          </button>
          <button className="sb-icon" aria-label="关闭AI总结" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {moduleUI.enabled('systemStudy') && (
        <nav className="sb-segment" style={{ margin: '8px 20px' }} aria-label="学习模式">
          <button className="active" aria-current="page">
            材料总结
          </button>
          <button onClick={() => setSystemStudy(true)}>系统学习</button>
        </nav>
      )}
      <div className="sb-study-scroll" ref={sourceRoot}>
        <div className="sb-study-inner">
          <div className="sb-study-topbar">
            <select
              aria-label="选择AI总结"
              disabled={!visibleSummaries.length}
              value={summary?.id || ''}
              onChange={(e) => {
                setActive(e.target.value);
                setExpand(null);
              }}
            >
              {!visibleSummaries.length && <option value="">暂无总结</option>}
              {[...visibleSummaries].reverse().map((s) => (
                <option value={s.id} key={s.id}>
                  {legacyStudy(s).title} · {date(s.createdAt)}
                </option>
              ))}
            </select>
            <B onClick={() => setGeneration((v) => !v)}>＋ 重新整理</B>
          </div>
          {deletedNotice && (
            <div className="sb-summary-deleted-notice" role="status">
              <span>已删除：{legacyStudy(deletedNotice).title}</span>
              <B disabled={deleting} onClick={() => changeDeleted(deletedNotice, false)}>
                撤销删除
              </B>
            </div>
          )}
          {removedSummaries.length > 0 && (
            <details className="sb-summary-trash">
              <summary>已删除的总结 · {removedSummaries.length}</summary>
              {[...removedSummaries].reverse().map((s) => (
                <div key={s.id}>
                  <span>
                    <strong>{legacyStudy(s).title}</strong>
                    <small>{date(s.createdAt)}</small>
                  </span>
                  <B disabled={deleting} onClick={() => changeDeleted(s, false)}>
                    恢复总结
                  </B>
                </div>
              ))}
            </details>
          )}
          {generation && (
            <section className="sb-generation">
              <div className="sb-model-field">
                <label htmlFor={modelSelectId}>模型</label>
                <div className="sb-model-label">
                  <select
                    id={modelSelectId}
                    value={route}
                    onChange={(e) => chooseRoute(e.target.value)}
                    disabled={running}
                  >
                    {models.map((m) => (
                      <option key={m.provider + m.id} value={`${m.provider}\n${m.id}`}>
                        {m.name}
                        {!m.vision ? ' · 文字' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`sb-icon sb-model-refresh ${loadingModels ? 'is-loading' : ''}`}
                    title="刷新模型列表"
                    aria-label="刷新模型列表"
                    disabled={loadingModels}
                    onClick={reloadModels}
                  >
                    <svg
                      width="19"
                      height="19"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 12l-2.3-5.7" />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="sb-muted">
                {selectedModel?.provider === 'codex-local'
                  ? '使用本机 Codex 登录 · 推理强度 ' + (selectedModel.reasoningEffort || '默认')
                  : '可选 DSH 已配置的模型，或使用本机 Codex 登录。'}
              </p>
              <div className="sb-segment">
                <button className={scope === 'board' ? 'active' : ''} onClick={() => setScope('board')}>
                  整张白板
                </button>
                <button
                  className={scope === 'selection' ? 'active' : ''}
                  onClick={() => setScope('selection')}
                >
                  选中区域
                </button>
              </div>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="可指定核心主题、想厘清的关系，或需要深入的部分"
                aria-label="学习目标"
                maxLength={2500}
              />
              <B
                primary
                disabled={busy || running || !route || !!selectedModel?.unavailable}
                onClick={() => generate()}
              >
                生成AI总结
              </B>
            </section>
          )}
          {running && (
            <div className="sb-generating">
              <span className="sb-pulse" />
              <div>
                <strong>{job.phase || '正在组织学习内容'}</strong>
                <p>
                  正在梳理主线、组织图文与关键关系。已用时{' '}
                  {Math.max(
                    0,
                    Math.floor((Date.now() - Date.parse(job.createdAt || new Date().toISOString())) / 60000),
                  )}{' '}
                  分{' '}
                  {Math.max(
                    0,
                    Math.floor((Date.now() - Date.parse(job.createdAt || new Date().toISOString())) / 1000) %
                      60,
                  )}{' '}
                  秒。
                </p>
              </div>
              <B onClick={() => api('cancelSummary', job.id).then(setJob).catch(onError)}>取消</B>
            </div>
          )}
          {job?.status === 'error' && (
            <p className="sb-notice" role="alert">
              {job.error}
            </p>
          )}
          {!study && !running && (
            <div className="sb-summary-empty">
              <h3>把画布串成一篇图文专题</h3>
              <p>围绕核心问题组织重点，按需使用原图与关系图。</p>
            </div>
          )}
          {study && (
            <>
              <header className="sb-study-title">
                <span className="sb-eyebrow">
                  {summary.kind === 'expand' ? 'EXPLORE / 主题拓展' : 'SUMMARY / AI总结'}
                </span>
                <h1>{study.title}</h1>
                <p>
                  {date(summary.createdAt)} ·{' '}
                  {summary.provider === 'codex-local'
                    ? summary.model === 'default'
                      ? 'Codex · 旧任务未记录具体模型'
                      : 'Codex · ' +
                        summary.model +
                        (summary.reasoningEffort ? ' · ' + summary.reasoningEffort : '')
                    : summary.model}
                </p>
                <div className="sb-study-actions">
                  <B
                    onClick={() =>
                      navigator.clipboard
                        .writeText(summary.text)
                        .then(() => onToast('已复制'))
                        .catch(onError)
                    }
                  >
                    复制
                  </B>
                  <B onClick={() => onAddCard(summary)}>放回白板批注</B>
                  {infographicsEnabled && (
                    <B
                      disabled={infographics.busy}
                      onClick={() => infographics.setComposer({ conceptId: '', title: study.title })}
                    >
                      生成信息图
                    </B>
                  )}
                  <B
                    className="sb-delete-summary"
                    disabled={deleting || busy}
                    title="删除当前总结，可在已删除总结中恢复"
                    onClick={() => changeDeleted(summary, true)}
                  >
                    删除这次总结
                  </B>
                  {!summary.study && (
                    <B
                      disabled={running || busy}
                      onClick={() => generate('restructure', { parentSummaryId: summary.id })}
                    >
                      整理为概念卡片
                    </B>
                  )}
                </div>
              </header>
              {enrolled && <p className="sb-success-note">{enrolled}</p>}
              <p className="sb-annotation-tip">选中文字后点击「划线」，可直接保存，也可顺手添加备注。</p>
              {study.overview && (
                <section className="sb-overview">
                  <AnnotatedText {...annotationProps} text={study.overview} blockId="overview" />
                </section>
              )}
              {study.takeaways?.length > 0 && (
                <ol className="sb-takeaways">
                  {study.takeaways.map((text, i) => (
                    <li key={i}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <AnnotatedText {...annotationProps} text={text} blockId={'takeaway:' + i} />
                    </li>
                  ))}
                </ol>
              )}
              {study.diagrams.filter((d) => d.placement === 'overview').map(diagramBlock)}
              {infographicsEnabled && <InfographicRegion {...infographicProps} />}
              <nav className="sb-topic-nav" aria-label="知识点目录">
                {study.concepts.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      document
                        .getElementById(`study-topic-${summary.id}-${c.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  >
                    {String(i + 1).padStart(2, '0')} {c.title}
                  </button>
                ))}
              </nav>
              {study.concepts.map((c, i) => (
                <article className="sb-concept" key={c.id} id={`study-topic-${summary.id}-${c.id}`}>
                  <header>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <h2>{c.title}</h2>
                    {infographicsEnabled && (
                      <B
                        disabled={infographics.busy}
                        onClick={() => infographics.setComposer({ conceptId: c.id, title: c.title })}
                      >
                        配图
                      </B>
                    )}
                    <B
                      disabled={running}
                      onClick={() =>
                        setExpand((current) =>
                          current?.origin === c.id
                            ? null
                            : { concept: c, origin: c.id, direction: '深入理解', question: '' },
                        )
                      }
                    >
                      拓展 ↗
                    </B>
                  </header>
                  {expand?.origin === c.id && (
                    <ExpansionEditor
                      expand={expand}
                      setExpand={setExpand}
                      models={models}
                      route={route}
                      chooseRoute={chooseRoute}
                      running={running}
                      busy={busy}
                      onGenerate={() =>
                        generate('expand', {
                          parentSummaryId: summary.id,
                          conceptId: expand.concept.id,
                          direction: expand.direction,
                          instructions: expand.question,
                        })
                      }
                      onOpen={(id) => {
                        setActive(id);
                        setExpand(null);
                      }}
                    />
                  )}
                  <AnnotatedText
                    {...annotationProps}
                    text={c.explanation}
                    blockId={`concept:${c.id}:explanation`}
                  />
                  {c.example && (
                    <section className="sb-example">
                      <h4>案例与补充</h4>
                      <AnnotatedText
                        {...annotationProps}
                        text={c.example}
                        blockId={`concept:${c.id}:example`}
                      />
                    </section>
                  )}
                  {c.prerequisites.length > 0 && (
                    <div className="sb-prerequisites">
                      <span>相关基础</span>
                      {c.prerequisites.map((p) => (
                        <span key={p}>{p}</span>
                      ))}
                    </div>
                  )}
                  {study.diagrams
                    .filter((d) => d.placement !== 'overview' && d.conceptIds[0] === c.id)
                    .map(diagramBlock)}
                  {(study.sourceFigures || []).filter((f) => f.conceptIds[0] === c.id).map(sourceBlock)}
                  {infographicsEnabled && <InfographicRegion {...infographicProps} conceptId={c.id} />}
                </article>
              ))}
              {study.diagrams
                .filter((d) => d.placement !== 'overview' && !d.conceptIds.length)
                .map(diagramBlock)}
              {(study.sourceFigures || []).filter((f) => !f.conceptIds.length).map(sourceBlock)}
              {!!study.insights?.length && (
                <section className="sb-topic-insights">
                  <h2>进一步理解</h2>
                  {study.insights.map((item) => (
                    <article key={item.id}>
                      <h3>{item.title}</h3>
                      <AnnotatedText {...annotationProps} text={item.text} blockId={'insight:' + item.id} />
                    </article>
                  ))}
                </section>
              )}
              {study.scopeNote && (
                <details className="sb-scope-note">
                  <summary>材料范围与说明</summary>
                  <AnnotatedText {...annotationProps} text={study.scopeNote} blockId="scopeNote" />
                </details>
              )}
              <Practice
                key={summary.id}
                questions={study.questions}
                concepts={study.concepts}
                initialQuestionId={
                  initialBlockId?.startsWith('question:') ? initialBlockId.split(':')[1] : null
                }
                onFeedback={
                  moduleUI.enabled('feedback')
                    ? (question, answer) =>
                        moduleUI.navigation.current.openFeature?.('feedback', {
                          boardId: board.id,
                          summaryId: summary.id,
                          mode: 'question',
                          questionId: question.id,
                          answer,
                        })
                    : null
                }
                onEnroll={enroll}
                renderAnswer={(q) => (
                  <AnnotatedText {...annotationProps} text={q.answer} blockId={`question:${q.id}:answer`} />
                )}
              />
              {!!study.extensions.length && (
                <section className="sb-extension-ideas">
                  <h3>继续往下想</h3>
                  {study.extensions.map((e, i) => (
                    <div key={i}>
                      <button
                        onClick={() =>
                          setExpand({
                            concept:
                              study.concepts.find((c) => e.topic.includes(c.title)) || study.concepts[0],
                            origin: `suggestion-${i}`,
                            direction: e.topic,
                            question: e.question,
                          })
                        }
                      >
                        <strong>{e.topic}</strong>
                        <span>{e.question} ↗</span>
                      </button>
                      {expand?.origin === `suggestion-${i}` && (
                        <ExpansionEditor
                          expand={expand}
                          setExpand={setExpand}
                          models={models}
                          route={route}
                          chooseRoute={chooseRoute}
                          running={running}
                          busy={busy}
                          onGenerate={() =>
                            generate('expand', {
                              parentSummaryId: summary.id,
                              conceptId: expand.concept.id,
                              direction: expand.direction,
                              instructions: expand.question,
                            })
                          }
                          onOpen={(id) => {
                            setActive(id);
                            setExpand(null);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
