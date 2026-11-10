import React, { useEffect, useRef, useState } from 'react';
import { useLearning } from './context.jsx';
import { Action, Evidence, ErrorNotice, TaskProgress, useCatalog, useTask } from './shared.jsx';
import { prepareInk } from './ink-preview.js';
const kinds = {
  metadata: '标题 / 标签',
  canvas: '画布文字',
  notes: '随手记',
  image: '图片 / 图注',
  handwriting: '手写',
  summary: 'AI总结',
  question: '自测题',
  annotation: '我的备注',
  material: '材料正文',
  'topic-report': '专题整理',
  'feedback-report': '理解反馈',
  'preview-report': '材料预览',
  'explore-report': '拓展记录',
};

export default function SearchView() {
  const learning = useLearning(),
    [catalog] = useCatalog(),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [result, setResult] = useState(null),
    [plan, setPlan] = useState([]),
    [chosen, setChosen] = useState([]),
    [preparing, setPreparing] = useState(''),
    [error, setError] = useState(''),
    [indexNote, setIndexNote] = useState(''),
    [ocr, setOcr] = useState([]),
    [edit, setEdit] = useState(null),
    epoch = useRef(0),
    mounted = useRef(true);
  const refresh = async () => {
    setPlan(await learning.api('execute', { action: 'search.plan' }));
    if (query.trim()) setResult(await learning.api('execute', { action: 'search.query', query, kind }));
  };
  const task = useTask('search', refresh);
  useEffect(() => {
    mounted.current = true;
    refresh().catch((error) => setError(error.message));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const token = ++epoch.current;
    if (!query.trim()) {
      setResult(null);
      return;
    }
    const timer = setTimeout(
      () =>
        learning
          .api('execute', { action: 'search.query', query, kind })
          .then((value) => {
            if (token === epoch.current) setResult(value);
          })
          .catch((error) => {
            if (token === epoch.current) setError(error.message);
          }),
      300,
    );
    return () => clearTimeout(timer);
  }, [query, kind]);
  async function index() {
    setError('');
    try {
      const selected = plan.filter((note) => !chosen.length || chosen.includes(note.id)).slice(0, 10),
        ink = {};
      for (const note of selected.filter((note) => note.pendingInk)) {
        if (!mounted.current) return;
        setPreparing('准备手写预览：' + note.title);
        const board = await learning.api('execute', { action: 'read', id: note.id });
        ink[note.id] = await prepareInk(board.scene);
      }
      if (mounted.current)
        await task.start({ action: 'search.index', noteIds: selected.map((note) => note.id), ink });
    } catch (error) {
      setError(error.message);
    } finally {
      if (mounted.current) setPreparing('');
    }
  }
  async function readOcr(id) {
    setIndexNote(id);
    if (!id) {
      setOcr([]);
      return;
    }
    try {
      setOcr(await learning.api('execute', { action: 'search.ocrRecords', id }));
    } catch (error) {
      setError(error.message);
    }
  }
  async function correct() {
    try {
      await learning.api('execute', { action: 'search.correct', id: indexNote, ...edit });
      setEdit(null);
      await readOcr(indexNote);
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <section className="sb-module-page">
      <header className="sb-module-header">
        <h1>全内容搜索</h1>
        <p>搜索文字、总结、图注、材料，以及已识别的图片和手写内容。</p>
      </header>
      <ErrorNotice error={error} />
      <div className="sb-module-searchbar">
        <input
          autoFocus
          aria-label="搜索所有学习内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入关键词或一个问题"
        />
        <select aria-label="搜索内容类型" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">所有内容</option>
          {Object.entries(kinds).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {plan.length > 0 && (
        <div className="sb-index-panel">
          <div>
            <strong>
              {plan.reduce((sum, note) => sum + note.pendingImages, 0)} 张图片、
              {plan.filter((note) => note.pendingInk).length} 篇手写笔记待识别
            </strong>
            <p>
              {learning.capabilities?.ocr?.available === false
                ? learning.capabilities.ocr.reason
                : '在本机识别，完成后即可搜索；每批最多处理 10 篇笔记。'}
            </p>
          </div>
          <Action
            disabled={task.busy || !!preparing || learning.capabilities?.ocr?.available === false}
            onClick={index}
          >
            识别图片与手写
          </Action>
          <details>
            <summary>选择本次处理的笔记</summary>
            {plan.map((note) => (
              <label key={note.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(note.id)}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked ? [...chosen, note.id] : chosen.filter((id) => id !== note.id),
                    )
                  }
                />
                {note.title}
              </label>
            ))}
          </details>
        </div>
      )}
      {preparing && (
        <p role="status" className="sb-success-note">
          {preparing}
        </p>
      )}
      <TaskProgress controller={task} />
      {task.task?.status === 'done' && (
        <p className="sb-module-meta">
          识别完成：{task.task.result?.indexed || 0} 项
          {task.task.result?.errors?.length
            ? '，' + task.task.result.errors.length + ' 项未成功，可重试'
            : ''}
        </p>
      )}
      {result && (
        <p className="sb-module-meta">
          找到 {result.matches.length} 条结果 · 已检索 {result.totalSources} 个内容片段
        </p>
      )}
      <div className="sb-search-results">
        {result?.matches.map((match) => (
          <article key={match.id}>
            <div>
              <span className="sb-module-badge">{kinds[match.kind] || match.kind}</span>
              <span className="sb-module-meta">{match.boardTitle}</span>
            </div>
            <h2>{match.title}</h2>
            <p>{match.snippet}</p>
            <div className="sb-module-inline">
              <Action onClick={() => learning.navigation.current.openSource?.(match)}>定位原文</Action>
              <Evidence sources={[{ ...match, quote: match.snippet }]} />
            </div>
          </article>
        ))}
        {result && !result.matches.length && (
          <p className="sb-empty">没有找到匹配内容。图片或手写尚未识别时，可先建立索引。</p>
        )}
      </div>
      <details className="sb-ocr-corrections">
        <summary>查看或修正识别文字</summary>
        <select
          aria-label="识别记录所属笔记"
          value={indexNote}
          onChange={(event) => readOcr(event.target.value)}
        >
          <option value="">选择笔记</option>
          {catalog.notes.map((note) => (
            <option key={note.id} value={note.id}>
              {note.title}
            </option>
          ))}
        </select>
        {ocr.map((entry) => (
          <article key={entry.imageId || entry.chunkId}>
            <strong>
              {entry.imageId ? '图片文字' : '手写文字'}
              {entry.manual ? ' · 已修正' : ''}
            </strong>
            <p>{entry.text || '未识别到文字，可手动补充。'}</p>
            <Action
              onClick={() =>
                setEdit({
                  imageId: entry.imageId || undefined,
                  chunkId: entry.chunkId || undefined,
                  text: entry.text,
                })
              }
            >
              修正识别文字
            </Action>
          </article>
        ))}
      </details>
      {edit && (
        <div className="sb-mask">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="修正识别文字"
            className="sb-modal sb-module-editor"
          >
            <header>
              <h2>修正识别文字</h2>
              <button aria-label="关闭文字修正" onClick={() => setEdit(null)}>
                ×
              </button>
            </header>
            <textarea
              aria-label="识别文字"
              value={edit.text}
              onChange={(event) => setEdit({ ...edit, text: event.target.value })}
              rows={12}
            />
            <footer>
              <Action onClick={() => setEdit(null)}>取消</Action>
              <Action primary onClick={correct}>
                保存修正
              </Action>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
