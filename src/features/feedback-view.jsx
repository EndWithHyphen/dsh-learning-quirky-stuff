import React, { useEffect, useState } from 'react';
import { useLearning } from './context.jsx';
import {
  Action,
  Evidence,
  ErrorNotice,
  ModelPicker,
  ReportStatus,
  TaskProgress,
  useCatalog,
  useTask,
  date,
  displayText,
  readDraft,
} from './shared.jsx';
import { highlightText } from './source-focus.js';
import { QuestionCard } from '../study-panel.jsx';

export default function FeedbackView({ context = {} }) {
  const learning = useLearning(),
    [catalog] = useCatalog(),
    [boardId, setBoardId] = useState(context.boardId || readDraft('studyboard-feedback-draft').boardId || ''),
    [reference, setReference] = useState(null),
    [mode, setMode] = useState(context.mode || 'summary'),
    [questionId, setQuestionId] = useState(context.questionId || ''),
    [relationId, setRelationId] = useState(''),
    [answer, setAnswer] = useState(context.answer || readDraft('studyboard-feedback-draft').answer || ''),
    [report, setReport] = useState(null),
    [history, setHistory] = useState([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(
        'studyboard-feedback-draft',
        JSON.stringify({ boardId, answer, mode, questionId, relationId }),
      );
    } catch {}
  }, [boardId, answer, mode, questionId, relationId]);
  const refreshHistory = () => learning.api('execute', { action: 'feedback.history' }).then(setHistory);
  const openReport = async (id) => setReport(await learning.api('execute', { action: 'feedback.get', id }));
  const task = useTask('feedback', async (result) => {
    await openReport(result.reportId);
    await refreshHistory();
  });
  useEffect(() => {
    refreshHistory().catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    if (context.boardId) {
      setBoardId(context.boardId);
      setAnswer(context.answer || '');
      setQuestionId(context.questionId || '');
      setMode(context.mode || 'summary');
    }
    if (context.reportId) openReport(context.reportId).catch((error) => setError(error.message));
  }, [context.boardId, context.questionId, context.reportId]);
  useEffect(() => {
    if (!boardId) return;
    learning
      .api('execute', {
        action: 'feedback.context',
        boardId,
        summaryId: context.boardId === boardId ? context.summaryId : undefined,
      })
      .then((value) => {
        setReference(value);
        if (!value.questions.some((question) => question.id === questionId))
          setQuestionId(value.questions[0]?.id || '');
        if (!value.relations.some((relation) => relation.id === relationId))
          setRelationId(value.relations[0]?.id || '');
      })
      .catch((error) => setError(error.message));
  }, [boardId]);
  async function resolve(value) {
    try {
      await learning.api('execute', { action: 'feedback.resolve', id: report.id, resolved: value });
      await openReport(report.id);
      await refreshHistory();
    } catch (error) {
      setError(error.message);
    }
  }
  async function enroll(index) {
    try {
      const result = await learning.api('execute', { action: 'feedback.enroll', id: report.id, index });
      setNotice(result.added ? '已加入复习' : '已在复习队列中');
    } catch (error) {
      setError(error.message);
    }
  }
  useEffect(() => {
    if (context.reportId && report?.id === context.reportId)
      requestAnimationFrame(() =>
        highlightText(document.querySelector('.sb-module-report'), context.textQuote),
      );
  }, [report?.id, context.reportId, context.textQuote]);
  const selectedQuestion = reference?.questions.find((question) => question.id === questionId),
    selectedRelation = reference?.relations.find((relation) => relation.id === relationId),
    value = report?.value;
  return (
    <section className="sb-module-page">
      <header className="sb-module-header">
        <h1>理解反馈</h1>
        <p>先用自己的话解释，再根据原文核对主线、遗漏和混淆。</p>
      </header>
      <ErrorNotice error={error} />
      <div className="sb-module-form">
        <label>
          学习内容
          <select
            aria-label="反馈来源笔记"
            value={boardId}
            onChange={(event) => setBoardId(event.target.value)}
          >
            <option value="">选择笔记</option>
            {catalog.notes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          练习方式
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="summary">复述主线</option>
            <option value="question" disabled={!reference?.questions.length}>
              回答已有自测题
            </option>
            <option value="relation" disabled={!reference?.relations.length}>
              补全图谱关系
            </option>
          </select>
        </label>
        {mode === 'question' && (
          <>
            <select
              aria-label="要回答的自测题"
              value={questionId}
              onChange={(event) => setQuestionId(event.target.value)}
            >
              {reference?.questions.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.prompt}
                </option>
              ))}
            </select>
            <p className="sb-feedback-question">
              {selectedQuestion?.prompt}
              {selectedQuestion?.context ? '\n' + selectedQuestion.context : ''}
            </p>
          </>
        )}
        {mode === 'relation' && (
          <>
            <select
              aria-label="要补全的关系"
              value={relationId}
              onChange={(event) => setRelationId(event.target.value)}
            >
              {reference?.relations.map((relation) => (
                <option key={relation.id} value={relation.id}>
                  {relation.subject} ↔ {relation.object}
                </option>
              ))}
            </select>
            <p className="sb-feedback-question">
              {selectedRelation?.subject} — ？ — {selectedRelation?.object}
              <small>说明关系、方向和依据。</small>
            </p>
          </>
        )}
        {mode === 'summary' && (
          <p className="sb-feedback-question">
            {reference?.summaryTitle || reference?.title || '选择学习内容后，尝试复述它的主线与关键联系。'}
          </p>
        )}
        <label>
          我的回答
          <textarea
            aria-label="我的理解"
            rows={7}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="先凭自己的理解说明。也可以使用 macOS 系统听写输入。"
            maxLength={20000}
          />
        </label>
        <ModelPicker feature="feedback" />
        <Action
          primary
          disabled={
            !boardId ||
            !answer.trim() ||
            task.busy ||
            (mode === 'question' && !questionId) ||
            (mode === 'relation' && !relationId)
          }
          onClick={() =>
            task.start({
              action: 'feedback.start',
              boardId,
              summaryId: reference?.summaryId,
              mode,
              questionId,
              relationId,
              answer,
            })
          }
        >
          获取理解反馈
        </Action>
      </div>
      <TaskProgress controller={task} />
      {history.length > 0 && (
        <label className="sb-module-history">
          反馈记录
          <select
            aria-label="反馈记录"
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
                {date(item.createdAt)} · {item.resolved ? '已理解 · ' : ''}
                {item.title.slice(0, 50)}
              </option>
            ))}
          </select>
        </label>
      )}
      <ReportStatus report={report} />
      {value && (
        <section className="sb-module-report">
          <h2>这次理解的反馈</h2>
          <p>{displayText(value.overview)}</p>
          <details>
            <summary>我的原回答</summary>
            <blockquote>{value.answer}</blockquote>
          </details>
          {value.strengths.length > 0 && (
            <section>
              <h2>已经说清楚的部分</h2>
              {value.strengths.map((item, index) => (
                <article key={index}>
                  <h3>{item.point}</h3>
                  <blockquote>{item.answerQuote}</blockquote>
                  <Evidence sources={item.evidence} />
                </article>
              ))}
            </section>
          )}
          {value.gaps.length > 0 && (
            <section>
              <h2>值得补齐的联系</h2>
              {value.gaps.map((item, index) => (
                <article key={index}>
                  <h3>{item.point}</h3>
                  <p>{item.reason}</p>
                  <Evidence sources={item.evidence} />
                </article>
              ))}
            </section>
          )}
          {value.corrections.length > 0 && (
            <section>
              <h2>需要核对的理解</h2>
              {value.corrections.map((item, index) => (
                <article key={index}>
                  <blockquote>{item.answerQuote}</blockquote>
                  <p>{item.explanation}</p>
                  <Evidence sources={item.evidence} />
                </article>
              ))}
            </section>
          )}
          <p className="sb-next-step">{value.nextStep}</p>
          <Action onClick={() => resolve(!value.resolved)}>
            {value.resolved ? '标为仍有疑问' : '标为已经理解'}
          </Action>
          {value.reviewQuestions.length > 0 && (
            <section>
              <h2>有针对性的复习</h2>
              {notice && <p className="sb-success-note">{notice}</p>}
              {value.reviewQuestions.map((question, index) => (
                <QuestionCard
                  key={index}
                  question={{ ...question, kind: 'explain' }}
                  onEnroll={() => enroll(index)}
                />
              ))}
            </section>
          )}
        </section>
      )}
    </section>
  );
}
