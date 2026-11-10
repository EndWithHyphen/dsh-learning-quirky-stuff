import React, { useEffect, useRef, useState } from 'react';
import { QuestionCard } from '../study-panel.jsx';
import { useLearning } from './context.jsx';
import { Action, Evidence, ErrorNotice } from './shared.jsx';

export default function WeeklyReview({ report, onChanged }) {
  const { api } = useLearning(),
    [session, setSession] = useState(null),
    [position, setPosition] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [completed, setCompleted] = useState(new Set()),
    alive = useRef(true),
    pending = useRef(new Map());
  useEffect(() => {
    alive.current = true;
    api('execute', { action: 'weekly.reviewSession', id: report.id })
      .then((data) => alive.current && setSession(data))
      .catch((e) => alive.current && setError(e.message));
    return () => {
      alive.current = false;
    };
  }, [report.id]);
  const questions = (session?.questions || []).filter((item) => !item.card?.suspended),
    at = Math.min(position, Math.max(0, questions.length - 1)),
    current = questions[at];
  function replaceCard(index, card) {
    setSession((old) => ({
      ...old,
      questions: old.questions.map((item) =>
        item.index === index
          ? {
              ...item,
              card: {
                id: card.id,
                version: card.version,
                suspended: card.suspended,
                due: card.schedule.dueAt,
                lastReviewedAt: card.lastReviewedAt || null,
              },
            }
          : item,
      ),
    }));
  }
  async function enroll(item) {
    setBusy(true);
    setError('');
    try {
      const result = await api('execute', { action: 'weekly.enroll', id: report.id, index: item.index });
      if (!alive.current) return;
      replaceCard(item.index, result.card);
      setNotice(
        result.card.suspended
          ? '这张题已设为不再出现，可在今日复习设置中恢复。'
          : result.added
            ? '已加入复习计划，可在「今日复习」继续。'
            : '已在复习计划中。',
      );
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function grade(item, value, answer) {
    if (!pending.current.has(item.index))
      pending.current.set(item.index, {
        action: 'weekly.grade',
        id: report.id,
        index: item.index,
        version: item.card?.version || 0,
        grade: value,
        answer,
        eventId: crypto.randomUUID(),
      });
    setBusy(true);
    setError('');
    try {
      const result = await api('execute', pending.current.get(item.index));
      pending.current.delete(item.index);
      if (!alive.current) return;
      replaceCard(item.index, result.card);
      setCompleted((old) => new Set([...old, item.index]));
      setNotice(
        '已记录本次复习，下次安排：' +
          new Date(result.card.schedule.dueAt).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
      );
      onChanged?.();
    } catch (e) {
      if (alive.current) setError('记录暂未确认，回答仍保留。' + e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function dismiss(item) {
    setBusy(true);
    setError('');
    try {
      const result = item.card
        ? { card: item.card }
        : await api('execute', { action: 'weekly.enroll', id: report.id, index: item.index });
      await api('execute', { action: 'suspendReview', cardId: result.card.id, suspended: true });
      if (alive.current) {
        setSession((old) => ({
          ...old,
          questions: old.questions.map((row) =>
            row.index === item.index ? { ...row, card: { ...result.card, suspended: true } } : row,
          ),
        }));
        setNotice('这道题已设为不再出现。');
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="sb-weekly-review" aria-label="本周复习">
      <header>
        <h3>复习本周的核心知识</h3>
        <p>先回忆，再揭晓答案。选择回忆表现会记录本次复习，并安排下一次；也可只加入复习计划。</p>
      </header>
      <ErrorNotice error={error} />
      {notice && (
        <p className="sb-success-note" role="status">
          {notice}
        </p>
      )}
      {!session && !error && <p role="status">正在准备复习题…</p>}
      {session && !current && (
        <p className="sb-muted">
          {session.questions.length
            ? '这些题已设为不再出现，可在「今日复习 → 复习设置」中恢复。'
            : '这份旧周报还没有复习题，重新生成本周总结后即可复习。'}
        </p>
      )}
      {current && (
        <>
          <div className="sb-weekly-review-nav">
            <Action
              disabled={busy || at === 0}
              onClick={() => {
                setPosition(at - 1);
                setNotice('');
              }}
            >
              上一题
            </Action>
            <span>
              第 {at + 1} / {questions.length} 题 · 本轮已记录 {completed.size} 题
            </span>
            <Action
              disabled={busy || at === questions.length - 1}
              onClick={() => {
                setPosition(at + 1);
                setNotice('');
              }}
            >
              下一题
            </Action>
          </div>
          {questions.map((item) => (
            <div key={item.index} hidden={item.index !== current.index}>
              <QuestionCard
                question={item.question}
                onEnroll={!busy && !item.card ? () => enroll(item) : undefined}
                footer={(answer) => (
                  <>
                    <Evidence sources={item.question.evidence} />
                    {completed.has(item.index) ? (
                      <p className="sb-success-note">这道题本轮已记录。</p>
                    ) : pending.current.has(item.index) ? (
                      <Action primary disabled={busy} onClick={() => grade(item)}>
                        重试保存本次复习
                      </Action>
                    ) : (
                      <div className="sb-weekly-grades">
                        <p>这次回忆起来怎样？</p>
                        <div>
                          {[
                            [1, '忘记'],
                            [2, '困难'],
                            [3, '记得'],
                            [4, '轻松'],
                          ].map(([value, label]) => (
                            <Action key={value} disabled={busy} onClick={() => grade(item, value, answer)}>
                              {label}
                            </Action>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              />
              <div className="sb-weekly-review-footer">
                <span className="sb-muted">{item.card ? '已关联复习计划' : '尚未加入长期复习计划'}</span>
                <Action disabled={busy || pending.current.has(item.index)} onClick={() => dismiss(item)}>
                  不再出现
                </Action>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
