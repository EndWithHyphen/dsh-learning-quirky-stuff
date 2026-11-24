import React, { useState } from 'react';
import { Action, Claim, ErrorNotice, Evidence, ReportStatus } from './shared.jsx';
import { templateLabel } from '../../shared/summary-templates.js';

export default function PageStudyReport({ report, enroll }) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const study = report.value;
  if (!study) return <p className="sb-notice">这份网页学习总结的来源已不可用。</p>;
  async function addToReview() {
    setBusy(true);
    setError('');
    try {
      const result = await enroll();
      setNotice(
        result.suspended
          ? `已加入 ${result.total - result.suspended} 道，${result.suspended} 道已停用。`
          : `${result.total} 道自测题已加入今日复习。`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sb-module-report sb-page-study" aria-label="网页学习总结">
      <h2>网页学习总结</h2>
      <p className="sb-muted">总结模板 · {templateLabel(report.template)}</p>
      <ReportStatus report={report} />
      {study.partial && <p className="sb-muted">本次总结仅覆盖已读取的部分正文或字幕。</p>}
      <Claim value={study.overview} />
      <h3>要点与记忆提示</h3>
      {study.points.map((point, i) => (
        <article key={i}>
          <h4>{point.title}</h4>
          <Claim value={point.body} />
          <p className="sb-page-study-cue">记忆提示 · {point.cue}</p>
        </article>
      ))}
      <h3>回忆自测</h3>
      {study.reviewQuestions.map((q, i) => (
        <details key={i}>
          <summary>{q.prompt}</summary>
          <p>{q.answer}</p>
          <Evidence sources={q.evidence} />
        </details>
      ))}
      <Action disabled={busy || !!notice || report.stale} onClick={addToReview}>
        将自测题加入今日复习
      </Action>
      {notice && <p role="status">{notice}</p>}
      <ErrorNotice error={error} />
    </section>
  );
}
