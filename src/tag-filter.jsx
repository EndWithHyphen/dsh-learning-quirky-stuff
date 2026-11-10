import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { findTags } from '../shared/tag-filters.js';

const COLLAPSED_COUNT = 8,
  PAGE_SIZE = 80;

export const TagPicker = React.forwardRef(function TagPicker(
  { entries, selected, onToggle, scope, onAllNotes },
  ref,
) {
  const [search, setSearch] = useState(''),
    [order, setOrder] = useState('usage'),
    [expanded, setExpanded] = useState(false),
    [limit, setLimit] = useState(PAGE_SIZE),
    root = useRef(),
    input = useRef();
  useImperativeHandle(
    ref,
    () => ({
      focusSearch() {
        const target = input.current || root.current;
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target?.focus({ preventScroll: true });
        input.current?.select();
      },
    }),
    [],
  );
  const matching = useMemo(() => findTags(entries, search, order), [entries, search, order]),
    searching = !!search.trim(),
    shown = matching.slice(0, searching || expanded ? limit : COLLAPSED_COUNT),
    remaining = matching.length - shown.length;
  function type(value) {
    setSearch(value);
    setLimit(PAGE_SIZE);
  }
  return (
    <section className="sb-tag-picker" aria-label="标签筛选" ref={root} tabIndex={-1}>
      <div className="sb-tag-picker-heading">
        <strong>标签</strong>
        <span>{entries.length}</span>
      </div>
      <p className="sb-tag-scope">{scope} · 数字为笔记数</p>
      {entries.length > 0 ? (
        <>
          <div className="sb-tag-search">
            <input
              ref={input}
              type="search"
              aria-label="搜索标签"
              placeholder="搜索标签…"
              value={search}
              onChange={(event) => type(event.target.value)}
            />
            {search && (
              <button aria-label="清除标签搜索" onClick={() => type('')}>
                ×
              </button>
            )}
          </div>
          <select
            className="sb-tag-order"
            aria-label="标签排序"
            value={order}
            onChange={(event) => setOrder(event.target.value)}
          >
            <option value="usage">常用优先</option>
            <option value="name">按名称排序</option>
          </select>
          {searching && (
            <p className="sb-tag-search-count" role="status">
              找到 {matching.length} 个标签
            </p>
          )}
          <div className="sb-tag-options" role="group" aria-label="可筛选的标签">
            {shown.map(({ name, count }) => (
              <label
                key={name}
                className={selected.includes(name) ? 'is-selected' : ''}
                title={name + ' · ' + count + ' 篇笔记'}
              >
                <input
                  type="checkbox"
                  aria-label={name}
                  checked={selected.includes(name)}
                  onChange={() => onToggle(name)}
                />
                <span className="sb-tag-name">#{name}</span>
                <span className="sb-tag-count" aria-hidden="true">
                  {count}
                </span>
              </label>
            ))}
            {!matching.length && <p className="sb-tag-no-match">当前范围没有匹配标签</p>}
          </div>
          <div className="sb-tag-more">
            {remaining > 0 && (
              <button
                onClick={() => {
                  setExpanded(true);
                  setLimit(expanded || searching ? limit + PAGE_SIZE : PAGE_SIZE);
                }}
              >
                {expanded || searching
                  ? '再显示 ' + Math.min(PAGE_SIZE, remaining) + ' 个'
                  : '查看全部 ' + entries.length + ' 个标签'}
              </button>
            )}
            {expanded && !searching && (
              <button
                onClick={() => {
                  setExpanded(false);
                  setLimit(PAGE_SIZE);
                }}
              >
                收起
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="sb-tag-no-match">当前范围还没有标签，可在「整理笔记」中添加。</p>
      )}
      {onAllNotes && (
        <button className="sb-tags-all-notes" onClick={onAllNotes}>
          在全部笔记中查找
        </button>
      )}
    </section>
  );
});

export function NoteFilters({
  selected,
  mode,
  query,
  scope,
  onRemove,
  onMode,
  onClear,
  onClearQuery,
  onAllNotes,
}) {
  if (!selected.length && !query.trim()) return null;
  return (
    <section className="sb-note-filters" aria-label="当前筛选条件">
      <div className="sb-filter-line">
        <span className="sb-filter-scope">范围：{scope}</span>
        {selected.length > 1 && (
          <div className="sb-tag-match-mode" role="group" aria-label="标签匹配方式">
            <button aria-pressed={mode === 'all'} onClick={() => onMode('all')}>
              同时包含
            </button>
            <button aria-pressed={mode === 'any'} onClick={() => onMode('any')}>
              任一匹配
            </button>
          </div>
        )}
        <button className="sb-clear-filters" onClick={onClear}>
          清空筛选
        </button>
      </div>
      <div className="sb-filter-chips">
        {selected.map((name) => (
          <button key={name} title={name} aria-label={'移除标签筛选：' + name} onClick={() => onRemove(name)}>
            <span>#{name}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {query.trim() && (
          <button aria-label="移除内容搜索" onClick={onClearQuery}>
            <span>内容：{query.trim()}</span>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {selected.length > 1 && (
        <p className="sb-filter-explanation">
          {mode === 'all' ? '笔记需同时带有以上所有标签。' : '笔记带有以上任意一个标签即可。'}
        </p>
      )}
      {onAllNotes && (
        <button className="sb-filter-widen" onClick={onAllNotes}>
          保留条件，在全部笔记中查找
        </button>
      )}
    </section>
  );
}
