import React, { useEffect, useRef, useState } from 'react';
import { useLearning } from './context.jsx';
import {
  Action,
  Claim,
  Evidence,
  ErrorNotice,
  ModelPicker,
  ReportStatus,
  TaskProgress,
  useCatalog,
  useTask,
} from './shared.jsx';
import { highlightText } from './source-focus.js';
import { StudyDiagram, QuestionCard } from '../study-panel.jsx';

export default function TopicsView({ context = {} }) {
  const learning = useLearning(),
    [catalog] = useCatalog(),
    [topics, setTopics] = useState([]),
    [loaded, setLoaded] = useState(false),
    [selected, setSelected] = useState(context.topicId || ''),
    [sourceReportId, setSourceReportId] = useState(context.reportId || ''),
    [detail, setDetail] = useState(null),
    [edit, setEdit] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    requestVersion = useRef(0);
  const reload = async (id = selected, reportId = sourceReportId) => {
    const version = ++requestVersion.current;
    const items = await learning.api('execute', { action: 'topics.list' });
    if (version !== requestVersion.current) return;
    setTopics(items);
    setLoaded(true);
    if (!id) {
      setDetail(null);
      const first = items.find((topic) => !topic.deletedAt);
      if (first && !context.reportId) setSelected(first.id);
      return;
    }
    if (id) {
      const data = await learning.api('execute', { action: 'topics.get', id });
      const report = reportId ? await learning.api('execute', { action: 'reports.get', id: reportId }) : null;
      if (version === requestVersion.current)
        setDetail(report?.key === id ? { ...data, report, sourceVersion: true } : data);
    }
  };
  const task = useTask(
    'topics',
    (result) => {
      setSourceReportId('');
      return reload(result.topicId, '');
    },
    selected || null,
  );
  useEffect(() => {
    reload().catch((error) => {
      setError(error.message);
      setLoaded(true);
    });
  }, [selected, sourceReportId]);
  useEffect(() => {
    if (context.reportId)
      learning
        .api('execute', { action: 'reports.get', id: context.reportId })
        .then((report) => {
          setSourceReportId(report.id);
          setSelected(report.key);
        })
        .catch((error) => setError(error.message));
  }, [context.reportId]);
  useEffect(() => {
    if (detail?.report?.id === context.reportId)
      requestAnimationFrame(() =>
        highlightText(document.querySelector('.sb-module-report'), context.textQuote),
      );
  }, [detail?.report?.id, context.reportId, context.textQuote]);
  async function save() {
    try {
      const topic = await learning.api('execute', { action: 'topics.save', ...edit });
      setEdit(null);
      setSelected(topic.id);
      await reload(topic.id);
    } catch (error) {
      setError(error.message);
    }
  }
  async function deleted(topic, value) {
    try {
      await learning.api('execute', { action: 'topics.save', id: topic.id, deleted: value });
      if (value && selected === topic.id) {
        setSelected('');
        setDetail(null);
      } else if (!value) {
        setSourceReportId('');
        setSelected(topic.id);
      }
      await reload(value ? '' : topic.id);
    } catch (error) {
      setError(error.message);
    }
  }
  async function enroll(index) {
    try {
      const result = await learning.api('execute', {
        action: 'topics.enroll',
        reportId: detail.report.id,
        index,
      });
      setNotice(result.added ? '已加入复习' : '已在复习队列中');
    } catch (error) {
      setError(error.message);
    }
  }
  const report = detail?.report,
    value = report?.value,
    visibleTopics = topics.filter((topic) => !topic.deletedAt),
    removedTopics = topics.filter((topic) => topic.deletedAt);
  const createTopic = () => setEdit({ title: '', description: '', noteIds: [], materialIds: [] });
  const archive = removedTopics.length > 0 && (
    <details className="sb-topics-archive">
      <summary>已删除专题 · {removedTopics.length}</summary>
      {removedTopics.map((topic) => (
        <div key={topic.id}>
          <span>{topic.title}</span>
          <Action onClick={() => deleted(topic, false)}>恢复</Action>
        </div>
      ))}
    </details>
  );
  return (
    <section className="sb-module-page sb-topics-page">
      <header className="sb-module-header">
        <div>
          <h1>专题工作台</h1>
          <p>围绕一个主题，连接多篇笔记，比较共识、分歧与新增内容。</p>
        </div>
        {visibleTopics.length > 0 && (
          <Action primary onClick={createTopic}>
            新建专题
          </Action>
        )}
      </header>
      <ErrorNotice error={error} />
      {!loaded ? (
        <p className="sb-muted" role="status">
          正在读取专题…
        </p>
      ) : !visibleTopics.length ? (
        <>
          {!error && (
            <section className="sb-topic-empty" aria-label="创建专题">
              <div className="sb-topic-empty-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 40 40"
                  width="30"
                  height="30"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="3" width="17" height="23" rx="2" />
                  <path d="M8 9h9M8 14h9M8 19h5" />
                  <rect x="19" y="16" width="17" height="21" rx="2" />
                  <path d="M24 23h7M24 28h7" />
                </svg>
              </div>
              <div>
                <h2>从一个想弄清的问题开始</h2>
                <p>选入相关笔记和材料，整理主线与不同观点。</p>
                <Action primary onClick={createTopic}>
                  新建专题
                </Action>
              </div>
            </section>
          )}
          {archive}
        </>
      ) : (
        <div className="sb-module-split">
          <aside className="sb-module-list">
            {visibleTopics.map((topic) => (
              <button
                key={topic.id}
                className={selected === topic.id ? 'active' : ''}
                onClick={() => {
                  setSourceReportId('');
                  setSelected(topic.id);
                }}
              >
                <strong>{topic.title}</strong>
                <small>
                  {topic.noteIds.length} 篇笔记 · {topic.materialIds.length} 份材料
                </small>
              </button>
            ))}
            {archive}
          </aside>
          <div className="sb-module-main">
            {detail?.topic.id === selected ? (
              <>
                <div className="sb-module-titleline">
                  <div>
                    <h2>{detail.topic.title}</h2>
                    <p>{detail.topic.description}</p>
                  </div>
                  <Action onClick={() => setEdit({ ...detail.topic })}>选择资料 / 编辑</Action>
                  <Action disabled={task.busy} onClick={() => deleted(detail.topic, true)}>
                    删除专题
                  </Action>
                </div>
                <ModelPicker feature="topics" />
                <Action
                  primary
                  disabled={task.busy || !detail.sourceCount}
                  onClick={() => task.start({ action: 'topics.generate', id: selected })}
                >
                  {report ? '更新专题' : '整理专题'}
                </Action>
                {detail.needsUpdate && !report?.unavailable && (
                  <p className="sb-notice">专题资料已有更新，重新整理可查看新增与变化。</p>
                )}
                <TaskProgress controller={task} />
                {!detail.sourceCount && (
                  <p className="sb-notice">
                    选中的资料还没有可分析的文字。可以补充文字、加入材料，或先识别图片和手写内容。
                    {learning.enabled('search') && (
                      <Action onClick={() => learning.navigation.current.openFeature?.('search')}>
                        识别图片与手写
                      </Action>
                    )}
                  </p>
                )}
                <ReportStatus report={report} />
                {detail.sourceVersion && (
                  <p className="sb-notice">
                    当前显示所引用的整理版本。
                    <Action onClick={() => setSourceReportId('')}>查看最新整理</Action>
                  </p>
                )}
                {value && (
                  <div className="sb-module-report">
                    <Claim value={value.overview} />
                    {value.diagram.nodes.length > 1 && (
                      <div className="sb-diagram-section">
                        <StudyDiagram diagram={value.diagram} />
                        <p>{value.diagram.caption}</p>
                      </div>
                    )}
                    {value.points.map((point, index) => (
                      <article key={index}>
                        <h2>{point.title}</h2>
                        <Claim value={point.body} />
                      </article>
                    ))}
                    {value.agreements.length > 0 && (
                      <section>
                        <h2>共同支持的结论</h2>
                        {value.agreements.map((claim, index) => (
                          <Claim key={index} value={claim} />
                        ))}
                      </section>
                    )}
                    {value.differences.length > 0 && (
                      <section>
                        <h2>不同观点与条件</h2>
                        {value.differences.map((difference, index) => (
                          <article key={index}>
                            <h3>{difference.title}</h3>
                            <div className="sb-module-comparison">
                              {difference.views.map((claim, i) => (
                                <Claim key={i} value={claim} />
                              ))}
                            </div>
                          </article>
                        ))}
                      </section>
                    )}
                    {value.changes.length > 0 && (
                      <section className="sb-module-changes">
                        <h2>这次新增与变化</h2>
                        {value.changes.map((change, index) => (
                          <article key={index}>
                            <span>
                              {{ added: '新增', changed: '修正', removed: '不再支持' }[change.kind]}
                            </span>
                            <p>{change.description}</p>
                            <Evidence sources={change.sources} />
                          </article>
                        ))}
                      </section>
                    )}
                    {value.gaps.length > 0 && (
                      <section>
                        <h2>值得补齐的问题</h2>
                        {value.gaps.map((gap, index) => (
                          <article key={index}>
                            <h3>{gap.question}</h3>
                            <p>{gap.reason}</p>
                            <Evidence sources={gap.sources} />
                            {learning.enabled('explore') && (
                              <Action
                                onClick={() =>
                                  learning.navigation.current.openFeature?.('explore', {
                                    focus: gap.question,
                                  })
                                }
                              >
                                探索这个问题
                              </Action>
                            )}
                          </article>
                        ))}
                      </section>
                    )}
                    {value.reviewQuestions?.length > 0 && (
                      <section>
                        <h2>专题自测</h2>
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
                  </div>
                )}
              </>
            ) : (
              <p className="sb-muted sb-topic-placeholder" role="status">
                {selected ? '正在读取专题内容…' : '选择左侧专题，查看资料与整理结果。'}
              </p>
            )}
          </div>
        </div>
      )}
      {edit && (
        <div className="sb-mask">
          <section
            className="sb-modal sb-module-editor"
            role="dialog"
            aria-modal="true"
            aria-label="编辑专题"
            onKeyDown={(event) => event.key === 'Escape' && setEdit(null)}
          >
            <header>
              <h2>{edit.id ? '编辑专题' : '新建专题'}</h2>
              <button aria-label="关闭专题编辑" onClick={() => setEdit(null)}>
                ×
              </button>
            </header>
            <label>
              专题名称
              <input
                autoFocus
                value={edit.title}
                onChange={(event) => setEdit({ ...edit, title: event.target.value })}
                maxLength={120}
              />
            </label>
            <label>
              想厘清的问题或方向
              <textarea
                value={edit.description}
                onChange={(event) => setEdit({ ...edit, description: event.target.value })}
              />
            </label>
            <h3>笔记</h3>
            <div className="sb-module-checklist">
              {catalog.notes.map((note) => (
                <label key={note.id}>
                  <input
                    type="checkbox"
                    checked={edit.noteIds.includes(note.id)}
                    onChange={(event) =>
                      setEdit({
                        ...edit,
                        noteIds: event.target.checked
                          ? [...edit.noteIds, note.id]
                          : edit.noteIds.filter((id) => id !== note.id),
                      })
                    }
                  />
                  <span>{note.title}</span>
                </label>
              ))}
            </div>
            {catalog.materials.length > 0 && (
              <>
                <h3>导入材料</h3>
                <div className="sb-module-checklist">
                  {catalog.materials.map((material) => (
                    <label key={material.id}>
                      <input
                        type="checkbox"
                        checked={edit.materialIds.includes(material.id)}
                        onChange={(event) =>
                          setEdit({
                            ...edit,
                            materialIds: event.target.checked
                              ? [...edit.materialIds, material.id]
                              : edit.materialIds.filter((id) => id !== material.id),
                          })
                        }
                      />
                      <span>{material.title}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <footer>
              <Action onClick={() => setEdit(null)}>取消</Action>
              <Action primary disabled={!edit.title.trim()} onClick={save}>
                保存专题
              </Action>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
