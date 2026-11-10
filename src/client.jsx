import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import excaliCSS from '@excalidraw/excalidraw/index.css';
import css from './style.css';
import { cleanState, thumbnail, summaryImages, pdfBlob, filename, download, liveElements } from './export.js';
import { draftRead, draftPut, draftDelete, draftPurge } from './drafts.js';
import { remoteInfo, apiFrom } from './remote.js';
import StudyPanel from './study-panel.jsx';
import { ReviewView, GraphView, CaptureView } from './learning-views.jsx';
import learningCSS from './learning.css';
import { bindCanvasShortcuts } from './canvas-shortcuts.js';
import CanvasShortcutHelp from './canvas-shortcut-help.jsx';
import shortcutCSS from './canvas-shortcuts.css';
import ImageText from './image-text.jsx';
import CanvasTools from './canvas-tools.jsx';
import LearningWidgets from './learning-widgets.jsx';
import { summaryCanvas } from './summary-canvas.js';
import { originalSummaryElements } from '../summary-sources.js';
import widgetCSS from './learning-widgets.css';
import { LearningProvider, useLearning, ModuleNav, FeatureSettings } from './features/context.jsx';
import ModulePage from './features/module-page.jsx';
import { FEATURE_IDS } from '../shared/features.js';
import moduleCSS from './features/modules.css';
import { highlightText } from './features/source-focus.js';
import HelpView from './help-view.jsx';
import { TagPicker, NoteFilters } from './tag-filter.jsx';
import { tagIndex, matchesTags, matchesNoteQuery } from '../shared/tag-filters.js';
import tagCSS from './tag-filter.css';
import graphCSS from './graph-curated.css';
import infographicCSS from './infographic.css';
import { buildInfographicScene, placeInfographic } from './infographic-render.js';

const words = {
  title: '学习画板',
  all: '全部笔记',
  uncategorized: '未分类',
  trash: '回收站',
  newNote: '新建笔记',
  newFolder: '新建分类',
  folders: '我的分类',
  labels: '标签',
  search: '搜索标题、文字和标签',
  empty: '让想法在这里展开',
  emptyHint: '新建一张白板，写写画画，或粘贴一张图片。',
  emptyFilter: '这里还没有笔记',
  summary: 'AI总结',
  pdf: '导出 PDF',
  back: '返回笔记',
  save: '保存',
  saved: '已保存',
  saving: '正在保存…',
  waiting: '等待保存…',
  retry: '重试保存',
  close: '关闭',
  cancel: '取消',
  confirm: '确定',
  name: '名称',
  parent: '上级分类',
  top: '无上级分类',
  edit: '编辑分类',
  delete: '删除空分类',
  tags: '标签（用逗号分隔）',
  folder: '分类',
  organize: '整理笔记',
  rename: '重命名',
  copy: '复制笔记',
  recover: '恢复笔记',
  remove: '移入回收站',
  backup: '下载备份',
  viewAll: '查看全部',
  models: '总结模型',
  noModel: '尚未找到可读图的模型，请先在 DSH 设置中配置。',
  summaryHint: '把手写、图片和箭头关系整理成知识点与自测题。',
  selection: '选中区域',
  whole: '整张白板',
  instructions: '补充要求（可选）',
  instructionsHint: '例如：重点解释推导过程，标出我理解有误的地方',
  start: '开始总结',
  stop: '取消总结',
  noSummary: '总结会保存在这篇笔记中',
  running: '正在阅读白板…',
  outdated: '笔记已更新，可重新总结',
  copySummary: '复制总结',
  addCard: '放回白板',
  history: '历史总结',
  pages: '分页导出',
  overview: '整张概览',
  pdfHint: '分页导出保留文字的可读大小；整张概览把白板放在一页中。',
  export: '导出',
  exporting: '正在导出…',
  restoreDraft: '发现尚未保存的本机草稿',
  restoreHint: '可以恢复上次退出前的内容，或继续打开已保存版本。',
  restore: '恢复草稿',
  discard: '使用已保存版本',
  noteTitle: '笔记标题',
  noMatches: '没有找到匹配的笔记',
  emptyTrash: '回收站是空的',
  hint: 'P 画笔 · E 橡皮擦 · 空格拖动 · ? 查看快捷键',
  error: '操作未完成',
  loading: '正在打开学习空间…',
  refresh: '刷新',
  summaryFailed: '总结失败',
  copyDone: '已复制',
  folderHint: '分类名称与层级完全由你决定。',
  notebooks: '篇笔记',
  custom: '按自己的方式整理',
  created: '创建于',
  recent: '最近更新',
  summaryTitle: '学习总结',
  noSelection: '请先用选择工具选中一部分内容',
  busySave: '正在保存，请稍候',
  corrupt: '部分笔记读取失败，原文件和备份已保留',
  fileTooBig: '图片过大，请缩小后再粘贴',
};
const NS = 'local-studyboard';
const iconPaths = {
  browser:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M3 8h18 M6 5.5h.01 M9 5.5h.01 M7 12h10 M7 16h6',
  book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  back: 'm14 5-7 7 7 7',
  spark: 'm12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z',
  file: 'M14 2H5v20h14V7z M14 2v6h5 M8 13h8M8 17h8',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  tag: 'M3 3h8l10 10-8 8L3 11zM7 7h.01',
  check: 'm5 12 4 4L19 6',
  close: 'M6 6l12 12M6 18 18 6',
  arrow: 'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4',
  pen: 'm4 20 4-1L20 7l-3-3L5 16z',
  layers: 'm12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',
};
function Icon({ name = 'book', size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name] || iconPaths.book} />
    </svg>
  );
}
function Button({ children, icon, primary = false, ...p }) {
  return (
    <button {...p} className={`sb-button ${primary ? 'sb-primary' : ''} ${p.className || ''}`}>
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const last = document.activeElement;
    ref.current?.querySelector('input,select,button')?.focus();
    return () => last?.focus();
  }, []);
  return (
    <div className="sb-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sb-modal"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Tab') {
            const a = [...ref.current.querySelectorAll('button:not(:disabled),input,select,textarea')];
            if (e.shiftKey && document.activeElement === a[0]) {
              e.preventDefault();
              a.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === a.at(-1)) {
              e.preventDefault();
              a[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="sb-icon" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Inline({ text }) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((s, i) =>
      s.startsWith('**') ? (
        <strong key={i}>{s.slice(2, -2)}</strong>
      ) : s.startsWith('`') ? (
        <code key={i}>{s.slice(1, -1)}</code>
      ) : (
        s
      ),
    );
}
function Markdown({ text }) {
  return (
    <div className="sb-markdown">
      {text.split('\n').map((line, i) => {
        if (/^#{1,3} /.test(line))
          return (
            <h3 key={i}>
              <Inline text={line.replace(/^#+ /, '')} />
            </h3>
          );
        if (/^[-*] /.test(line))
          return (
            <div key={i} className="sb-bullet">
              • <Inline text={line.slice(2)} />
            </div>
          );
        return line ? (
          <p key={i}>
            <Inline text={line.replace(/^>\s?/, '')} />
          </p>
        ) : (
          <div key={i} className="sb-gap" />
        );
      })}
    </div>
  );
}
function sortedFolders(folders, parent = null, depth = 0, seen = new Set()) {
  return folders
    .filter((f) => f.parentId === parent && !seen.has(f.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .flatMap((f) => {
      const s = new Set([...seen, f.id]);
      return [{ ...f, depth }, ...sortedFolders(folders, f.id, depth + 1, s)];
    });
}
function descendants(folders, id) {
  const ids = new Set([id]);
  for (let i = 0; i < folders.length; i++) for (const f of folders) if (ids.has(f.parentId)) ids.add(f.id);
  return ids;
}
function relativeDate(date) {
  const d = new Date(date);
  return (
    d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  );
}

function StudyApp(props) {
  return (
    <LearningProvider api={props.api}>
      <StudyShell {...props} />
    </LearningProvider>
  );
}
function StudyShell({ api, t }) {
  const moduleUI = useLearning(),
    [moduleContext, setModuleContext] = useState({});
  const [lib, setLib] = useState(null),
    [board, setBoard] = useState(null),
    [view, setView] = useState('all'),
    [query, setQuery] = useState(''),
    [selectedTags, setSelectedTags] = useState([]),
    [tagMode, setTagMode] = useState('all'),
    [modal, setModal] = useState(null),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [working, setWorking] = useState(false);
  const editor = useRef(),
    tagPicker = useRef(),
    changingNotes = useRef(new Set()),
    boardRef = useRef(board),
    purgeChannel = useRef(null);
  boardRef.current = board;
  const [pendingNotes, setPendingNotes] = useState(new Set());
  const [dueCount, setDueCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const d = await api('execute', { action: 'reviewDashboard' });
        if (!alive) return;
        setDueCount(d.dueCount);
        const today = new Date().toLocaleDateString();
        if (
          d.settings.reminderEnabled &&
          d.dueCount > 0 &&
          new Date().getHours() >= d.settings.reminderHour &&
          localStorage.getItem('studyboard-reminded') !== today &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          new Notification('今天的学习复习', { body: `有 ${d.dueCount} 张卡片到期，打开学习画板继续练习。` });
          localStorage.setItem('studyboard-reminded', today);
        }
      } catch {}
    };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [api]);
  const fail = (e) => setError(e.message || String(e));
  const refresh = useCallback(async () => {
    const l = await api('execute', { action: 'library' });
    setLib(l);
    draftPurge(l.purgedIds || []).catch(() => {});
    if (l.errors.length) setError(t('corrupt'));
  }, [api]);
  useEffect(() => {
    refresh().catch(fail);
  }, [refresh]);
  useEffect(() => {
    if (board) return;
    const update = () => refresh().catch(fail);
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, [board, refresh]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), toast.undoNote ? 8000 : 2800);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function removePurged(ids) {
    const removed = new Set(ids);
    if (removed.has(boardRef.current?.id)) {
      editor.current?.forget?.().catch(() => {});
      setBoard(null);
    }
    setLib((prev) => (prev ? { ...prev, boards: prev.boards.filter((b) => !removed.has(b.id)) } : prev));
    draftPurge(ids).catch(() => {});
  }
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('studyboard-purged-notes');
    purgeChannel.current = channel;
    channel.onmessage = (event) => {
      if (Array.isArray(event.data?.ids)) {
        removePurged(event.data.ids);
        setModal(null);
        refresh().catch(fail);
      }
    };
    return () => channel.close();
  }, [refresh]);
  async function purge(request) {
    setToast('');
    try {
      const result = await api('execute', request);
      removePurged(result.ids);
      purgeChannel.current?.postMessage({ ids: result.ids });
      setModal(null);
      setToast('已永久删除 ' + result.ids.length + ' 篇笔记');
      await refresh();
      return result;
    } catch (e) {
      await refresh().catch(() => {});
      throw e;
    }
  }
  async function open(id, summaryId, sourceFocus) {
    try {
      setWorking(true);
      await editor.current?.flush();
      setBoard({
        ...(await api('execute', { action: 'read', id })),
        _focusSummaryId: summaryId || null,
        _sourceFocus: sourceFocus ? { ...sourceFocus, token: Date.now() } : null,
      });
    } catch (e) {
      fail(e);
    } finally {
      setWorking(false);
    }
  }
  async function openFeature(id, context = {}) {
    try {
      if (id === 'systemStudy' && context.reportId) {
        const { report } = await api('execute', { action: 'systemStudy.get', id: context.reportId });
        await open(report.key, null, { systemStudyId: report.id });
        return;
      }
      await editor.current?.flush();
      setBoard(null);
      setModuleContext(context);
      setView(id);
    } catch (error) {
      fail(error);
    }
  }
  async function openSource(source) {
    if (source.reportId) {
      await openFeature(source.feature, {
        reportId: source.reportId,
        topicId: source.topicId,
        materialId: source.previewMaterialId,
        textQuote: source.quote || source.snippet || '',
      });
    } else if (source.materialId) {
      await openFeature('preview', { materialId: source.materialId, blockId: source.locator?.blockId });
    } else if (source.boardId) {
      await open(source.boardId, source.summaryId, {
        ...source.locator,
        kind: source.kind,
        textQuote: source.quote || source.snippet || '',
      });
    }
  }
  moduleUI.navigation.current = { openFeature, openSource };
  async function create() {
    try {
      await editor.current?.flush();
      const folderId = lib?.folders.some((folder) => folder.id === view) ? view : null;
      setBoard(await api('execute', { action: 'create', title: '新笔记', folderId }));
      await refresh();
    } catch (e) {
      fail(e);
    }
  }
  async function home() {
    try {
      await editor.current?.flush();
      setBoard(null);
      await refresh();
    } catch (e) {
      fail(e);
    }
  }
  async function run(r) {
    const v = await api('execute', r);
    await refresh();
    return v;
  }
  async function setNoteDeleted(note, deleted) {
    if (changingNotes.current.has(note.id)) return;
    changingNotes.current.add(note.id);
    setPendingNotes(new Set(changingNotes.current));
    try {
      const value = await api('execute', { action: 'metadata', id: note.id, deleted });
      setLib((previous) => ({
        ...previous,
        boards: previous.boards.map((b) => (b.id === note.id ? { ...b, ...value } : b)),
      }));
      setToast(
        deleted
          ? { message: `「${note.title}」已移入回收站`, undoNote: note }
          : { message: `「${note.title}」已恢复` },
      );
    } catch (e) {
      fail(e);
    } finally {
      changingNotes.current.delete(note.id);
      setPendingNotes(new Set(changingNotes.current));
    }
  }
  const flat = sortedFolders(lib?.folders || []);
  const folderIds = descendants(lib?.folders || [], view);
  const isNoteList =
    ['all', 'none', 'trash'].includes(view) || (lib?.folders || []).some((folder) => folder.id === view);
  const scopeNotes = (lib?.boards || []).filter(
    (b) =>
      (view === 'trash' ? !!b.deletedAt : !b.deletedAt) &&
      (!isNoteList ||
        view === 'all' ||
        view === 'trash' ||
        (view === 'none' && !b.folderId) ||
        folderIds.has(b.folderId)),
  );
  const notes = scopeNotes.filter(
    (note) => matchesTags(note, selectedTags, tagMode) && matchesNoteQuery(note, query),
  );
  const tagEntries = tagIndex(scopeNotes),
    hasFilters = selectedTags.length > 0 || !!query.trim();
  const heading =
    view === 'all'
      ? t('all')
      : view === 'none'
        ? t('uncategorized')
        : view === 'trash'
          ? t('trash')
          : lib?.folders.find((f) => f.id === view)?.name || t('all');
  const filterScope = isNoteList
    ? heading + (lib?.folders.some((folder) => folder.id === view) ? '（含子分类）' : '')
    : t('all');
  const showAllNotes = () => setView('all');
  const clearFilters = () => {
    setSelectedTags([]);
    setQuery('');
    setTagMode('all');
  };
  function toggleTag(name) {
    if (!isNoteList) {
      setView('all');
      setQuery('');
      setSelectedTags([name]);
      return;
    }
    setSelectedTags((previous) =>
      previous.includes(name) ? previous.filter((tag) => tag !== name) : [...previous, name],
    );
  }
  return (
    <main className="sb-app">
      <style>
        {excaliCSS +
          '\n' +
          css +
          '\n' +
          learningCSS +
          '\n' +
          shortcutCSS +
          '\n' +
          widgetCSS +
          '\n' +
          moduleCSS +
          '\n' +
          tagCSS +
          '\n' +
          graphCSS +
          '\n' +
          infographicCSS}
      </style>
      {error && (
        <div role="alert" className="sb-error">
          <span>{error}</span>
          <button className="sb-icon" onClick={() => setError('')} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="sb-toast">
          <Icon name="check" />
          <span>{typeof toast === 'string' ? toast : toast.message}</span>
          {toast.undoNote && (
            <button
              disabled={pendingNotes.has(toast.undoNote.id)}
              onClick={() => setNoteDeleted(toast.undoNote, false)}
            >
              撤销
            </button>
          )}
        </div>
      )}
      {!lib ? (
        <div className="sb-loading">{t('loading')}</div>
      ) : board ? (
        <Board
          key={board.id}
          ref={editor}
          board={board}
          api={api}
          t={t}
          onBack={home}
          onError={fail}
          onToast={setToast}
          onOrganize={() => setModal({ kind: 'note', note: board })}
          onUpdate={(b) => setBoard((prev) => ({ ...prev, ...b }))}
        />
      ) : (
        <>
          <header className="sb-home-head" data-window-drag>
            <div className="sb-brand">
              <span className="sb-brand-icon">
                <Icon size={23} />
              </span>
              <div>
                <h1>{t('title')}</h1>
                <p>{t('custom')}</p>
              </div>
            </div>
            <Button primary icon="plus" onClick={create}>
              {t('newNote')}
            </Button>
          </header>
          <div className="sb-home-body">
            <aside className="sb-nav">
              {[
                ['all', 'layers', 'all'],
                ['none', 'file', 'uncategorized'],
              ].map(([id, icon, label]) => (
                <button
                  key={id}
                  className={`sb-nav-row ${view === id ? 'active' : ''}`}
                  onClick={() => {
                    setView(id);
                    setSelectedTags([]);
                  }}
                >
                  <Icon name={icon} />
                  <span>{t(label)}</span>
                  <small>
                    {lib.boards.filter((b) => !b.deletedAt && (id === 'all' || !b.folderId)).length}
                  </small>
                </button>
              ))}
              <button
                className={`sb-nav-row ${view === 'review' ? 'active' : ''}`}
                onClick={() => setView('review')}
              >
                <Icon name="check" />
                <span>今日复习</span>
                {dueCount > 0 && <small className="sb-due-badge">{dueCount}</small>}
              </button>
              <button
                className={`sb-nav-row ${view === 'graph' ? 'active' : ''}`}
                onClick={() => setView('graph')}
              >
                <Icon name="spark" />
                <span>知识图谱</span>
              </button>
              <ModuleNav
                view={view}
                onSelect={(id) => {
                  setModuleContext({});
                  setView(id);
                }}
              />
              <div className="sb-section-head">
                <span>{t('folders')}</span>
                <button
                  className="sb-icon"
                  aria-label={t('newFolder')}
                  onClick={() => setModal({ kind: 'folder' })}
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
              {!flat.length && (
                <button className="sb-add-folder" onClick={() => setModal({ kind: 'folder' })}>
                  ＋ {t('newFolder')}
                </button>
              )}
              {flat.map((f) => (
                <div
                  className={`sb-folder-row ${view === f.id ? 'active' : ''}`}
                  key={f.id}
                  style={{ paddingLeft: 10 + f.depth * 13 }}
                >
                  <button
                    onClick={() => {
                      setView(f.id);
                      setSelectedTags([]);
                    }}
                  >
                    <Icon name="folder" size={16} />
                    <span>{f.name}</span>
                  </button>
                  <button
                    className="sb-icon"
                    aria-label={`${t('edit')} ${f.name}`}
                    onClick={() => setModal({ kind: 'folder', folder: f })}
                  >
                    <Icon name="dots" size={15} />
                  </button>
                </div>
              ))}
              <TagPicker
                ref={tagPicker}
                entries={tagEntries}
                selected={isNoteList ? selectedTags : []}
                onToggle={toggleTag}
                scope={filterScope}
                onAllNotes={isNoteList && !['all', 'trash'].includes(view) ? showAllNotes : undefined}
              />
              <div className="sb-nav-bottom">
                <button
                  className={'sb-nav-row ' + (view === 'help' ? 'active' : '')}
                  onClick={() => setView('help')}
                >
                  <Icon name="book" />
                  <span>使用说明</span>
                </button>
                <button
                  className={'sb-nav-row ' + (view === 'features' ? 'active' : '')}
                  onClick={() => setView('features')}
                >
                  <Icon name="dots" />
                  <span>功能设置</span>
                </button>
                <button
                  className={`sb-nav-row ${view === 'capture' ? 'active' : ''}`}
                  onClick={() => setView('capture')}
                >
                  <Icon name="browser" />
                  <span>浏览器快捷笔记</span>
                </button>
                <button
                  className={`sb-nav-row ${view === 'trash' ? 'active' : ''}`}
                  onClick={() => {
                    setView('trash');
                    setSelectedTags([]);
                  }}
                >
                  <Icon name="trash" />
                  <span>{t('trash')}</span>
                </button>
                <button
                  className="sb-nav-row"
                  onClick={async () => {
                    try {
                      const backup = await api('execute', { action: 'backup' });
                      download(
                        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
                        `学习画板备份-${new Date().toISOString().slice(0, 10)}.json`,
                      );
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  <Icon name="arrow" />
                  <span>{t('backup')}</span>
                </button>
              </div>
            </aside>
            <section className="sb-library">
              {view === 'help' ? (
                <HelpView />
              ) : view === 'features' ? (
                <FeatureSettings />
              ) : FEATURE_IDS.includes(view) ? (
                <ModulePage key={view} feature={view} context={moduleContext} />
              ) : view === 'review' ? (
                <ReviewView api={api} onError={fail} onOpen={open} onChanged={setDueCount} />
              ) : view === 'graph' ? (
                <GraphView api={api} onError={fail} onOpen={open} />
              ) : view === 'capture' ? (
                <CaptureView api={api} onError={fail} />
              ) : (
                <>
                  <div className="sb-library-bar">
                    <div>
                      <h2>{heading}</h2>
                      <p>
                        {notes.length} {t('notebooks')}
                      </p>
                    </div>
                    <label className="sb-search">
                      <Icon name="search" size={17} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('search')}
                        aria-label={t('search')}
                      />
                    </label>
                    <Button
                      icon="tag"
                      aria-label="搜索和筛选标签"
                      onClick={() => tagPicker.current?.focusSearch()}
                    >
                      标签{selectedTags.length ? ' · ' + selectedTags.length : ''}
                    </Button>
                    {view === 'trash' && lib.boards.some((b) => b.deletedAt) && (
                      <Button
                        className="sb-danger"
                        icon="trash"
                        onClick={() =>
                          setModal({ kind: 'purge', notes: lib.boards.filter((b) => b.deletedAt) })
                        }
                      >
                        清空回收站
                      </Button>
                    )}
                    <button
                      className="sb-icon"
                      onClick={() => refresh().catch(fail)}
                      aria-label={t('refresh')}
                    >
                      ↻
                    </button>
                  </div>
                  <NoteFilters
                    selected={selectedTags}
                    mode={tagMode}
                    query={query}
                    scope={filterScope}
                    onRemove={toggleTag}
                    onMode={setTagMode}
                    onClear={clearFilters}
                    onClearQuery={() => setQuery('')}
                    onAllNotes={!['all', 'trash'].includes(view) ? showAllNotes : undefined}
                  />
                  {!notes.length ? (
                    <div className="sb-empty">
                      <div className="sb-empty-art">
                        <Icon name="pen" size={43} />
                      </div>
                      <h2>
                        {hasFilters
                          ? '没有符合筛选条件的笔记'
                          : view === 'trash'
                            ? t('emptyTrash')
                            : t('empty')}
                      </h2>
                      <p>
                        {hasFilters
                          ? '可以移除标签、修改搜索词，或在全部笔记中查找。'
                          : view === 'trash'
                            ? ''
                            : t('emptyHint')}
                      </p>
                      {hasFilters ? (
                        <Button onClick={clearFilters}>清空当前筛选</Button>
                      ) : (
                        view !== 'trash' && (
                          <Button primary icon="plus" onClick={create}>
                            {t('newNote')}
                          </Button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="sb-grid">
                      {notes.map((n) => (
                        <article className="sb-card" key={n.id}>
                          <button
                            className="sb-card-open"
                            disabled={working || !!n.deletedAt}
                            onClick={() => open(n.id)}
                          >
                            <div className="sb-preview">
                              {n.thumbnail ? (
                                <img src={n.thumbnail} alt="" />
                              ) : (
                                <Icon name="file" size={32} />
                              )}
                            </div>
                            <div className="sb-card-copy">
                              <h3>{n.title}</h3>
                              <p>
                                {relativeDate(n.updatedAt)}
                                {n.summaryCount ? ` · ${t('summary')}` : ''}
                              </p>
                              <div className="sb-tags">
                                {n.tags.slice(0, 3).map((v) => (
                                  <span className="sb-tag" key={v}>
                                    #{v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </button>
                          <div className="sb-card-actions">
                            <button
                              className="sb-icon"
                              aria-label={`${t('organize')} ${n.title}`}
                              title={t('organize')}
                              disabled={pendingNotes.has(n.id)}
                              onClick={() => setModal({ kind: 'note', note: n })}
                            >
                              <Icon name="dots" />
                            </button>
                            <button
                              className={`sb-card-delete ${n.deletedAt ? 'sb-card-restore' : ''}`}
                              disabled={pendingNotes.has(n.id)}
                              aria-label={`${n.deletedAt ? '恢复' : '删除'} ${n.title}`}
                              title={n.deletedAt ? '恢复笔记' : '移入回收站，可撤销'}
                              onClick={() => setNoteDeleted(n, !n.deletedAt)}
                            >
                              <Icon name={n.deletedAt ? 'back' : 'trash'} size={15} />
                              <span>
                                {pendingNotes.has(n.id) ? '处理中…' : n.deletedAt ? '恢复' : '删除'}
                              </span>
                            </button>
                            {n.deletedAt && (
                              <button
                                className="sb-card-delete"
                                aria-label={'永久删除 ' + n.title}
                                onClick={() => setModal({ kind: 'purge', notes: [n] })}
                              >
                                <Icon name="trash" size={15} />
                                永久删除
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
      {modal?.kind === 'purge' && (
        <PurgeModal notes={modal.notes} onClose={() => setModal(null)} onConfirm={purge} />
      )}
      {modal?.kind === 'folder' && (
        <FolderModal
          t={t}
          folders={flat}
          folder={modal.folder}
          onClose={() => setModal(null)}
          onSave={async (r) => {
            try {
              await run(r);
              setModal(null);
              if (r.action === 'deleteFolder' && view === r.id) setView('all');
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {modal?.kind === 'note' && (
        <NoteModal
          t={t}
          folders={flat}
          note={modal.note}
          onClose={() => setModal(null)}
          onSave={async (r) => {
            try {
              await editor.current?.flush();
              const v = await run(r);
              setModal(null);
              if (board?.id === r.id) {
                if (r.deleted) setBoard(null);
                else if (r.action === 'metadata') setBoard((prev) => ({ ...prev, ...v }));
              }
              if (r.action === 'duplicate') setBoard(v);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
    </main>
  );
}
function PurgeModal({ notes, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm({ action: 'purgeNotes', ids: notes.map((n) => n.id), confirm: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={notes.length > 1 ? '清空选中的回收站笔记' : '永久删除笔记'}
      onClose={() => !busy && onClose()}
    >
      <p>将永久删除以下 {notes.length} 篇笔记，以及其中的图片、总结、批注和关联复习记录。</p>
      <ul className="sb-purge-list">
        {notes.map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
      <p className="sb-muted">
        此操作无法撤销。相关图谱整理结果会清理，可重新生成。历史备份文件需要单独管理。
      </p>
      {error && (
        <p role="alert" className="sb-notice">
          {error}
        </p>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button disabled={busy} className="sb-purge-confirm" onClick={confirm}>
          {busy ? '正在清理…' : '确认永久删除'}
        </Button>
      </footer>
    </Modal>
  );
}
function FolderModal({ t, folders, folder, onClose, onSave }) {
  const [name, setName] = useState(folder?.name || ''),
    [parent, setParent] = useState(folder?.parentId || ''),
    [busy, setBusy] = useState(false);
  const submit = async (r) => {
    setBusy(true);
    try {
      await onSave(r);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={folder ? t('edit') : t('newFolder')} onClose={onClose}>
      <p className="sb-muted">{t('folderHint')}</p>
      <label>
        {t('name')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          onKeyDown={(e) =>
            e.key === 'Enter' &&
            name.trim() &&
            submit({ action: 'folder', id: folder?.id, name, parentId: parent || null })
          }
        />
      </label>
      <label>
        {t('parent')}
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">{t('top')}</option>
          {folders
            .filter((f) => f.id !== folder?.id)
            .map((f) => (
              <option value={f.id} key={f.id}>
                {'　'.repeat(f.depth) + f.name}
              </option>
            ))}
        </select>
      </label>
      <footer>
        {folder && (
          <Button
            disabled={busy}
            className="sb-danger"
            onClick={() => submit({ action: 'deleteFolder', id: folder.id })}
          >
            {t('delete')}
          </Button>
        )}
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          primary
          disabled={!name.trim() || busy}
          onClick={() => submit({ action: 'folder', id: folder?.id, name, parentId: parent || null })}
        >
          {t('save')}
        </Button>
      </footer>
    </Modal>
  );
}
function NoteModal({ t, folders, note, onClose, onSave }) {
  const [title, setTitle] = useState(note.title),
    [folder, setFolder] = useState(note.folderId || ''),
    [tagText, setTags] = useState(note.tags.join(', ')),
    [busy, setBusy] = useState(false);
  async function submit(r) {
    setBusy(true);
    try {
      await onSave(r);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('organize')} onClose={onClose}>
      <label>
        {t('noteTitle')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label>
        {t('folder')}
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">{t('uncategorized')}</option>
          {folders.map((f) => (
            <option value={f.id} key={f.id}>
              {'　'.repeat(f.depth) + f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('tags')}
        <input value={tagText} onChange={(e) => setTags(e.target.value)} placeholder="概念, 待复习" />
      </label>
      <div className="sb-modal-actions">
        <Button disabled={busy} icon="file" onClick={() => submit({ action: 'duplicate', id: note.id })}>
          {t('copy')}
        </Button>
        <Button
          disabled={busy}
          icon="trash"
          onClick={() => submit({ action: 'metadata', id: note.id, deleted: !note.deletedAt })}
        >
          {note.deletedAt ? t('recover') : t('remove')}
        </Button>
      </div>
      <footer>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          primary
          disabled={busy}
          onClick={() =>
            submit({
              action: 'metadata',
              id: note.id,
              title,
              folderId: folder || null,
              tags: tagText
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          {t('save')}
        </Button>
      </footer>
    </Modal>
  );
}

const Board = React.forwardRef(function Board(
  { board, api, t, onBack, onError, onToast, onOrganize, onUpdate },
  ref,
) {
  const boardModules = useLearning();
  const [ready, setReady] = useState(false),
    [recover, setRecover] = useState(null),
    [initial, setInitial] = useState(board.scene),
    [saveState, setSaveState] = useState('saved'),
    [summaryOpen, setSummaryOpen] = useState(!!board._focusSummaryId || !!board._sourceFocus?.systemStudyId),
    [summaries, setSummaries] = useState(board.summaries),
    [pdf, setPdf] = useState(false),
    [pdfMode, setPdfMode] = useState('pages'),
    [busy, setBusy] = useState(false),
    [dark, setDark] = useState(document.body.hasAttribute('data-ds-dark-theme'));
  const [canvasEpoch, setCanvasEpoch] = useState(0),
    [shortcutsOpen, setShortcutsOpen] = useState(false);
  const canvasRoot = useRef(null),
    shortcutActions = useRef({}),
    learningWidgets = useRef(null),
    forgotten = useRef(false);
  const excali = useRef(null),
    scene = useRef(board.scene),
    rev = useRef(board.revision),
    dirty = useRef(false),
    sequence = useRef(0),
    timer = useRef(null),
    saving = useRef(null),
    lastHash = useRef(''),
    mounted = useRef(true);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    draftRead(board.id)
      .then((d) => {
        if (d?.scene && JSON.stringify(d.scene) !== JSON.stringify(board.scene)) setRecover(d);
        else setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')));
    o.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    const unload = (e) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (forgotten.current) return;
    if (saving.current) {
      await saving.current;
      if (dirty.current) return flush();
      return;
    }
    if (!dirty.current) return;
    saving.current = (async () => {
      while (dirty.current && !forgotten.current) {
        const seq = sequence.current,
          current = scene.current;
        setSaveState('saving');
        await draftPut(board.id, {
          scene: current,
          baseRevision: rev.current,
          updatedAt: new Date().toISOString(),
        });
        let thumb = null;
        try {
          thumb = await thumbnail(current);
        } catch {}
        const meta = await api('execute', {
          action: 'save',
          id: board.id,
          baseRevision: rev.current,
          scene: current,
          ...(thumb ? { thumbnail: thumb } : {}),
        });
        if (forgotten.current) return;
        rev.current = meta.revision;
        dirty.current = sequence.current !== seq;
        if (!dirty.current) await draftDelete(board.id);
        if (mounted.current) {
          setSaveState(dirty.current ? 'waiting' : 'saved');
          onUpdate(meta);
        }
      }
    })();
    try {
      await saving.current;
    } catch (e) {
      if (mounted.current) setSaveState('error');
      throw e;
    } finally {
      saving.current = null;
    }
  }, [api, board.id]);
  React.useImperativeHandle(ref, () => ({
    flush,
    forget: async () => {
      forgotten.current = true;
      dirty.current = false;
      clearTimeout(timer.current);
      await saving.current?.catch(() => {});
      await draftPurge([board.id]);
    },
  }));
  shortcutActions.current = { save: flush, pdf: () => setPdf(true), error: onError };
  useEffect(() => {
    if (!ready || !canvasRoot.current) return;
    return bindCanvasShortcuts(canvasRoot.current, {
      getApi: () => excali.current,
      onSave: () => shortcutActions.current.save(),
      onExport: () => shortcutActions.current.pdf(),
      onHelp: () => setShortcutsOpen(true),
      onWidget: (kind) => learningWidgets.current?.open(kind),
      onError: (e) => shortcutActions.current.error(e),
    });
  }, [ready, canvasEpoch]);
  useEffect(() => {
    let stopped = false;
    const refreshReading = async () => {
      if (dirty.current || saving.current) return;
      try {
        const fresh = await api('execute', { action: 'read', id: board.id });
        if (stopped || dirty.current || saving.current) return;
        setSummaries(fresh.summaries);
        onUpdate({ webNotes: fresh.webNotes, webImageCount: fresh.webImages?.length || 0 });
        if (fresh.revision !== rev.current) {
          scene.current = fresh.scene;
          rev.current = fresh.revision;
          lastHash.current = '';
          setInitial(fresh.scene);
          setCanvasEpoch((v) => v + 1);
        }
      } catch {}
    };
    window.addEventListener('focus', refreshReading);
    return () => {
      stopped = true;
      window.removeEventListener('focus', refreshReading);
    };
  }, [api, board.id]);

  useEffect(() => {
    if (!ready || !board._sourceFocus) return;
    let frame,
      attempts = 0;
    const focus = () => {
      if (!excali.current && attempts++ < 30) {
        frame = requestAnimationFrame(focus);
        return;
      }
      if (!excali.current) return;
      const ids = board._sourceFocus.elementIds || [],
        elements = excali.current.getSceneElements().filter((element) => ids.includes(element.id));
      if (elements.length) {
        excali.current.updateScene({
          appState: { selectedElementIds: Object.fromEntries(elements.map((element) => [element.id, true])) },
        });
        excali.current.setActiveTool({ type: 'selection' });
        excali.current.scrollToContent(elements, { fitToViewport: true, maxZoom: 1 });
      }
      if (board._sourceFocus.kind === 'notes')
        highlightText(document.querySelector('.sb-web-notes>div'), board._sourceFocus.textQuote);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [ready, canvasEpoch, board._sourceFocus?.token]);
  function change(elements, state, files) {
    if (forgotten.current) return;
    scene.current = {
      elements: elements.map((e) => ({ ...e })),
      appState: cleanState(state),
      files: { ...files },
    };
    const hash =
      elements.map((e) => `${e.id}:${e.version}:${e.isDeleted}`).join('|') +
      '#' +
      Object.keys(files).join('|') +
      '#' +
      state.viewBackgroundColor +
      '#' +
      state.gridSize;
    if (!lastHash.current) {
      lastHash.current = hash;
      return;
    }
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    sequence.current++;
    dirty.current = true;
    setSaveState('waiting');
    clearTimeout(timer.current);
    draftPut(board.id, {
      scene: scene.current,
      baseRevision: rev.current,
      updatedAt: new Date().toISOString(),
    }).catch(errorRef.current);
    timer.current = setTimeout(() => flush().catch(errorRef.current), 1100);
  }
  async function generate(options) {
    await flush();
    const latest = await api('execute', { action: 'read', id: board.id });
    if (latest.revision !== rev.current) {
      scene.current = latest.scene;
      rev.current = latest.revision;
      lastHash.current = '';
      setInitial(latest.scene);
      setCanvasEpoch((v) => v + 1);
    }
    onUpdate({ webNotes: latest.webNotes });
    let images = [],
      elements = [];
    if (options.mode === 'summary' || options.mode === 'systemStudy') {
      const selected = excali.current.getAppState().selectedElementIds || {};
      elements = originalSummaryElements(scene.current.elements, latest.summaries).filter(
        (e) => options.scope !== 'selection' || selected[e.id] || (e.containerId && selected[e.containerId]),
      );
      if (
        !elements.length &&
        (options.scope === 'selection' ||
          (!(latest.webNotes?.text || '').trim() &&
            !(options.mode === 'systemStudy' && latest.summaries.some((s) => !s.deletedAt))))
      )
        throw new Error(t(options.scope === 'selection' ? 'noSelection' : 'emptyHint'));
      if (elements.length && options.useImages !== false)
        images = await summaryImages(scene.current, elements);
    }
    if (options.mode === 'systemStudy')
      return api('execute', {
        action: 'systemStudy.start',
        noteId: board.id,
        revision: rev.current,
        images,
        elementIds: elements.map((e) => e.id),
        scope: options.scope,
        focus: options.focus,
        goal: options.goal,
        web: options.web,
        history: options.history,
        related: options.related,
        route: { provider: options.provider, model: options.model },
      });
    return api('startSummary', { ...options, id: board.id, revision: rev.current, images, elements });
  }
  async function exportPdf() {
    try {
      setBusy(true);
      await flush();
      download(await pdfBlob(board, scene.current, pdfMode), filename(board.title, 'pdf'));
      setPdf(false);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function addCard(s) {
    try {
      const figures = [];
      if (!s.infographicScene && boardModules.enabled('infographics')) {
        const manifest = await api('execute', {
            action: 'infographics.list',
            noteId: board.id,
            summaryId: s.id,
          }),
          latest = new Map();
        for (const entry of manifest.entries)
          if (!manifest.hidden.includes(entry.slotId)) latest.set(entry.slotId, entry);
        for (const info of latest.values()) {
          const value = await api('execute', {
            action: 'infographics.get',
            noteId: board.id,
            summaryId: s.id,
            id: info.id,
          });
          figures.push({
            entry: value.entry,
            scene: value.canvas?.scene || (await buildInfographicScene(value.entry)),
          });
        }
      }
      const els = liveElements(scene.current.elements),
        maxX = els.length ? Math.max(...els.map((e) => e.x + e.width)) : 0,
        minY = els.length ? Math.min(...els.map((e) => e.y)) : 0;
      const { elements, files } = s.infographicScene
        ? placeInfographic(s.infographicScene, { x: maxX + 100, y: minY })
        : summaryCanvas(s, scene.current, { x: maxX + 100, y: minY }, figures);
      if (files.length) excali.current.addFiles(files);
      excali.current.updateScene({
        elements: [...excali.current.getSceneElementsIncludingDeleted(), ...elements],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const first = elements.slice(0, Math.min(7, elements.length));
      excali.current.scrollToContent(first, { fitToViewport: true, maxZoom: 1 });
      setSummaryOpen(false);
      onToast('图文专题已放回白板，可继续圈画和批注');
    } catch (e) {
      onError(e);
    }
  }

  function updateSummary(value, meta) {
    setSummaries((all) =>
      all.some((s) => s.id === value.id) ? all.map((s) => (s.id === value.id ? value : s)) : [...all, value],
    );
    if (meta) onUpdate(meta);
  }
  return (
    <section className="sb-board">
      <header className="sb-board-header" data-window-drag>
        <button className="sb-icon" aria-label={t('back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="sb-board-title">
          <button onClick={onOrganize}>{board.title}</button>
          <span className={`sb-save-state ${saveState === 'error' ? 'bad' : ''}`}>
            {saveState === 'saved' && <Icon name="check" size={12} />}{' '}
            {saveState === 'error' ? (
              <button onClick={() => flush().catch(onError)}>{t('retry')}</button>
            ) : (
              t(saveState)
            )}
          </span>
        </div>
        <Button icon="folder" onClick={onOrganize}>
          {t('organize')}
        </Button>
        <Button disabled={!ready} onClick={() => learningWidgets.current?.openMenu()}>
          学习控件
        </Button>
        <Button title="画布快捷键（?）" onClick={() => setShortcutsOpen(true)}>
          快捷键
        </Button>
        <Button icon="file" title="导出 PDF（Option/Alt + Shift + P）" onClick={() => setPdf(true)}>
          {t('pdf')}
        </Button>
        <Button primary icon="spark" onClick={() => setSummaryOpen((v) => !v)}>
          {t('summary')}
          {summaries.some((s) => !s.deletedAt) ? ` · ${summaries.filter((s) => !s.deletedAt).length}` : ''}
        </Button>
      </header>
      {board.source && (
        <div className="sb-source-link">
          <span>来自网页</span>
          <a href={board.source.url} target="_blank" rel="noreferrer">
            {board.source.title || board.source.url} ↗
          </a>
        </div>
      )}
      {board.webNotes?.text && (
        <details className="sb-web-notes" open>
          <summary>网页随手记 · {board.webNotes.text.length} 字</summary>
          <div>{board.webNotes.text}</div>
        </details>
      )}
      <div className="sb-board-body">
        <div className="sb-canvas-column">
          <CanvasTools key={canvasEpoch} apiRef={excali} rootRef={canvasRoot}>
            <ImageText
              apiRef={excali}
              rootRef={canvasRoot}
              noteId={board.id}
              execute={(r) => api('execute', r)}
              flush={flush}
            />
          </CanvasTools>
          <div className="sb-canvas study-canvas-surface" ref={canvasRoot}>
            {ready && (
              <Excalidraw
                key={canvasEpoch}
                excalidrawAPI={(value) => {
                  excali.current = value;
                }}
                initialData={{
                  ...initial,
                  appState: { ...initial.appState, currentItemFontFamily: 2, theme: dark ? 'dark' : 'light' },
                  scrollToContent: true,
                }}
                onChange={change}
                langCode="zh-CN"
                theme={dark ? 'dark' : 'light'}
                name={board.title}
                handleKeyboardGlobally={false}
                UIOptions={{
                  tools: { laser: false },
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    export: false,
                    saveAsImage: false,
                    toggleTheme: false,
                  },
                }}
              >
                <MainMenu>
                  <MainMenu.DefaultItems.ClearCanvas />
                </MainMenu>
              </Excalidraw>
            )}
            <LearningWidgets key={canvasEpoch} ref={learningWidgets} apiRef={excali} rootRef={canvasRoot} />

            {shortcutsOpen && (
              <CanvasShortcutHelp root={canvasRoot.current} pdf onClose={() => setShortcutsOpen(false)} />
            )}
          </div>
        </div>
        {summaryOpen && (
          <StudyPanel
            board={{ ...board, summaries }}
            api={api}
            onError={onError}
            onToast={onToast}
            onGenerate={generate}
            onAddCard={addCard}
            onClose={() => setSummaryOpen(false)}
            onSummaryChange={updateSummary}
            initialSummaryId={board._focusSummaryId}
            initialSystemStudyId={board._sourceFocus?.systemStudyId}
            initialBlockId={board._sourceFocus?.blockId}
            sourceQuote={board._sourceFocus?.textQuote}
          />
        )}
      </div>
      {pdf && (
        <Modal title={t('pdf')} onClose={() => !busy && setPdf(false)}>
          <p className="sb-muted">{t('pdfHint')}</p>
          <div className="sb-export-choices">
            {['pages', 'overview'].map((v) => (
              <button key={v} className={pdfMode === v ? 'active' : ''} onClick={() => setPdfMode(v)}>
                <Icon name={v === 'pages' ? 'layers' : 'file'} size={28} />
                <strong>{t(v)}</strong>
              </button>
            ))}
          </div>
          <footer>
            <Button disabled={busy} onClick={() => setPdf(false)}>
              {t('cancel')}
            </Button>
            <Button primary disabled={busy} onClick={exportPdf}>
              {t(busy ? 'exporting' : 'export')}
            </Button>
          </footer>
        </Modal>
      )}
      {recover && (
        <Modal title={t('restoreDraft')} onClose={() => {}}>
          <p>{t('restoreHint')}</p>
          <footer>
            <Button
              onClick={() => {
                draftDelete(board.id).catch(onError);
                setRecover(null);
                setReady(true);
              }}
            >
              {t('discard')}
            </Button>
            <Button
              primary
              onClick={() => {
                setInitial(recover.scene);
                scene.current = recover.scene;
                dirty.current = true;
                sequence.current++;
                setSaveState('waiting');
                setRecover(null);
                setReady(true);
                timer.current = setTimeout(() => flush().catch(onError), 1500);
              }}
            >
              {t('restore')}
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
});

export const inject = ['slots', 'locale', 'remote'];
export async function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: words, en: words }));
  await ctx.remote.$mount(remoteInfo);
  ctx.inject(['remote.studyboard'], (scoped) => {
    const api = apiFrom(scoped),
      t = ctx.locale.bind(NS);
    scoped.effect(() => {
      let stopped = false;
      const remind = async () => {
        try {
          const d = await api('execute', { action: 'reviewDashboard' }),
            today = new Date().toLocaleDateString();
          if (
            stopped ||
            !d.settings.reminderEnabled ||
            !d.dueCount ||
            new Date().getHours() < d.settings.reminderHour ||
            typeof Notification === 'undefined' ||
            Notification.permission !== 'granted' ||
            localStorage.getItem('studyboard-reminded') === today
          )
            return;
          new Notification('今天的学习复习', { body: `有 ${d.dueCount} 张卡片到期，打开学习画板继续练习。` });
          localStorage.setItem('studyboard-reminded', today);
        } catch {}
      };
      remind();
      const timer = setInterval(remind, 60000);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    });

    const Panel = () => <StudyApp api={api} t={t} />;
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: 'local-studyboard', locale: NS }, Panel),
    );
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: 'local-studyboard', order: 5, label: () => t('title'), locale: NS },
        Icon,
      ),
    );
  });
}
