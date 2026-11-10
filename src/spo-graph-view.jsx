import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GraphAiPanel from './graph-ai-panel.jsx';
import GraphCanvas from './graph-canvas.jsx';
import { graphProjection } from './graph-layout.js';
import GraphSourceCard from './graph-source-card.jsx';
import { withGraphProvenance, graphSourceKey, graphSourceKind, graphSourceDate } from './graph-provenance.js';
const kinds = {
  person: '人物',
  organization: '组织',
  group: '群体',
  concept: '概念',
  policy: '政策',
  event: '事件',
};
const B = ({ children, ...props }) => (
  <button {...props} className={'sb-button ' + (props.className || '')}>
    {children}
  </button>
);
let rememberedView = null;
export default function SpoGraphView({ api, onError, onOpen }) {
  const [graph, setGraph] = useState(null),
    [query, setQuery] = useState(''),
    [mapId, setMapId] = useState(''),
    [branchId, setBranchId] = useState(''),
    [mode, setMode] = useState('main'),
    [focusId, setFocusId] = useState(''),
    [detail, setDetail] = useState(null),
    [linking, setLinking] = useState(false),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [predicate, setPredicate] = useState(''),
    [busy, setBusy] = useState(false),
    loaded = useRef(false),
    reportId = useRef(null);
  const reload = () =>
    api('execute', { action: 'graph' })
      .then((value) => setGraph(withGraphProvenance(value)))
      .catch(onError);
  useEffect(() => {
    reload();
  }, []);
  useLayoutEffect(() => {
    if (!graph) return;
    const id = graph.aiReport?.id || null;
    if (!loaded.current || reportId.current !== id) {
      const saved = !loaded.current && rememberedView?.reportId === id ? rememberedView : null;
      setMapId(saved?.mapId ?? (graph.maps?.length === 1 ? graph.maps[0].id : 'all'));
      setBranchId(saved?.branchId || '');
      setQuery(saved?.query || '');
      setFocusId(saved?.focusId || '');
      setMode(saved?.mode || 'main');
      setDetail(null);
      loaded.current = true;
      reportId.current = id;
    }
  }, [graph?.aiReport?.id, !!graph]);
  useEffect(() => {
    if (loaded.current && graph)
      rememberedView = { reportId: graph.aiReport?.id || null, mapId, branchId, mode, query, focusId };
  }, [graph, mapId, branchId, mode, query, focusId]);
  useLayoutEffect(() => {
    if (!graph || !loaded.current) return;
    const current = graph.maps?.find((map) => map.id === mapId);
    if (mapId && mapId !== 'all' && !current && !graph.topics?.some((topic) => topic.id === mapId)) {
      setMapId(graph.maps?.length === 1 ? graph.maps[0].id : 'all');
      setBranchId('');
    } else if (branchId && !current?.branches.some((branch) => branch.id === branchId)) setBranchId('');
    if (focusId && !graph.nodes.some((node) => node.id === focusId)) setFocusId('');
  }, [graph, mapId, branchId, focusId]);
  const projection = useMemo(
    () =>
      graph
        ? graphProjection(graph, { mapId, branchId, mode, query, focusId })
        : { nodes: [], edges: [], groups: [] },
    [graph, mapId, branchId, mode, query, focusId],
  );
  const names = new Map((graph?.nodes || []).map((n) => [n.id, n.title])),
    map = projection.map,
    branch = projection.branch;
  const visibleSourceNumbers = new Set(projection.edges.flatMap((edge) => edge.sourceNumbers || []));
  const visibleSources =
    graph?.sourceCatalog?.filter((source) => visibleSourceNumbers.has(source.number)) || [];
  const activeBranch = branch && mode === 'main' && !focusId && !query.trim() ? branch : null;
  const introduction = activeBranch ? activeBranch.summary : map?.takeaway;
  const chooseMap = (id) => {
    setMapId(id);
    setBranchId('');
    setFocusId('');
    setQuery('');
    setMode('main');
    setDetail(null);
  };
  const chooseBranch = (id) => {
    setBranchId(id);
    setFocusId('');
    setQuery('');
    setMode('main');
  };
  const rootView = () => {
    setBranchId('');
    setFocusId('');
    setQuery('');
    setMode('main');
  };
  async function history(value) {
    setBusy(true);
    try {
      await api('execute', { action: 'graphSettings', includeHistory: value });
      await reload();
      setDetail(null);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    setBusy(true);
    try {
      await api('execute', { action: 'linkConcepts', from, to, label: predicate });
      setLinking(false);
      setPredicate('');
      await reload();
      setMapId('all');
      setBranchId('');
      setFocusId('');
      setQuery('');
      setMode('triples');
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const triple = (edge) => (
    <>
      <strong>{names.get(edge.from)}</strong>
      <span className="sb-spo-predicate">{edge.label} →</span>
      <strong>{names.get(edge.to)}</strong>
    </>
  );
  if (!graph) return <div className="sb-loading">正在读取图谱主线…</div>;
  const overview = mode === 'main' && mapId === 'all' && graph.maps?.length > 1 && !query.trim() && !focusId;
  const tableMode = mode === 'triples' || (mode === 'main' && !graph.maps?.length);
  return (
    <section className="sb-learning-page sb-graph-page sb-graph-curated">
      <header className="sb-page-title">
        <div>
          <h1>知识图谱</h1>
          <p>先读主题主干，再展开分支。关系上的编号对应下方来源。</p>
        </div>
        <B disabled={!graph.nodes.length} onClick={() => setLinking((v) => !v)}>
          添加关系
        </B>
      </header>
      <div className="sb-graph-stance">
        <strong>所选材料的观点图谱 · 未独立核实</strong>
        <p>
          关系来自材料、笔记及 AI
          总结中的表述，可能有误读、争议或遗漏。引用出处说明观点从哪里来，不代表观点已被证实；图谱仅覆盖本次所选内容。
        </p>
      </div>
      <GraphAiPanel graph={graph} api={api} onError={onError} onRefresh={reload} />
      <div className="sb-graph-scope-controls">
        <select aria-label="图谱主题" value={mapId} onChange={(event) => chooseMap(event.target.value)}>
          <option value="all">全部主题</option>
          {(graph.maps?.length ? graph.maps : graph.topics || []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <input
          aria-label="搜索实体或关系"
          placeholder="在当前主题中找实体或关系"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocusId('');
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={!!graph.includeHistory}
            disabled={busy}
            onChange={(event) => history(event.target.checked)}
          />
          整理时包含历史总结
        </label>
      </div>
      {linking && (
        <section className="sb-spo-link">
          <label>
            主体
            <select aria-label="关系主体" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">选择实体</option>
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            关系
            <input
              aria-label="关系谓词"
              value={predicate}
              onChange={(e) => setPredicate(e.target.value)}
              placeholder="支持、主张、依赖…"
              maxLength={40}
            />
          </label>
          <label>
            客体
            <select aria-label="关系客体" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">选择实体</option>
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <B disabled={busy || !from || !to || from === to || !predicate.trim()} onClick={link}>
            保存关系
          </B>
        </section>
      )}
      {!graph.nodes.length ? (
        <div className="sb-empty">
          <h2>{graph.coverage?.sourceBlocks ? '为这个主题整理主线' : '先为笔记生成总结'}</h2>
          <p>
            {graph.coverage?.sourceBlocks
              ? '点击「AI整理图谱」，提炼主干与必要分支。'
              : '有了总结后，可以在这里建立有依据的知识联系。'}
          </p>
        </div>
      ) : (
        <>
          {graph.needsCuration && (
            <p className="sb-notice">
              {graph.aiReport?.schemaVersion === 3
                ? '主干的来源已有变化，当前保留仍有效的关系明细。'
                : '这份旧图谱尚未区分主干与细节，重新整理后可生成主题主线。'}
            </p>
          )}
          {map && (
            <div className="sb-graph-topic-intro">
              <span className="sb-eyebrow">{map.title}</span>
              <h2>{map.question}</h2>
              {introduction && (
                <details className="sb-graph-explanation" key={activeBranch?.id || 'main'}>
                  <summary>{activeBranch ? '分支解释与来源' : '主线解释与来源'}</summary>
                  <p>{introduction.text}</p>
                  <div className="sb-graph-claim-sources">
                    {[...new Set(introduction.evidence.map(graphSourceKey))].map((key) => {
                      const source = graph.sourceCatalog.find((s) => s.key === key);
                      return (
                        source && (
                          <button key={key} onClick={() => setDetail({ kind: 'source', id: key })}>
                            [{source.number}] {graphSourceKind(source)} ·{' '}
                            {source.summaryTitle || source.boardTitle}
                          </button>
                        )
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          )}
          <div className="sb-graph-view-controls">
            <div role="tablist" aria-label="图谱展示方式">
              <button role="tab" aria-selected={mode === 'main'} onClick={rootView}>
                主题主线
              </button>
              <button
                role="tab"
                aria-selected={mode === 'full'}
                onClick={() => {
                  setMode('full');
                  setFocusId('');
                }}
              >
                完整图谱
              </button>
              <button
                role="tab"
                aria-selected={mode === 'triples'}
                onClick={() => {
                  setMode('triples');
                  setFocusId('');
                }}
              >
                三元组
              </button>
            </div>
            <span className="sb-graph-scope-count">
              下次整理 · {graph.includeHistory ? '包含历史总结' : '各范围的最新总结'}
            </span>
          </div>
          {overview ? (
            <div className="sb-graph-topic-grid">
              {graph.maps.map((item) => (
                <button key={item.id} onClick={() => chooseMap(item.id)}>
                  <span>
                    {item.coreEntityIds.length} 个主干实体 · {item.branches.length} 个分支
                  </span>
                  <h2>{item.title}</h2>
                  <p>{item.question}</p>
                  <strong>打开主题主线 →</strong>
                </button>
              ))}
            </div>
          ) : (
            <>
              {mode === 'main' && map && map.branches.length > 0 && (
                <nav className="sb-graph-branch-nav" aria-label="主题分支">
                  <button aria-pressed={!branchId && !focusId && !query.trim()} onClick={rootView}>
                    {activeBranch ? '返回主题主干' : '主干'}
                  </button>
                  {map.branches.map((item) => (
                    <button
                      key={item.id}
                      title={item.title}
                      aria-label={'展开分支：' + item.title}
                      aria-pressed={branchId === item.id && !focusId && !query.trim()}
                      onClick={() => chooseBranch(item.id)}
                    >
                      {item.title}
                      <small>{item.tripleIds.length} 条</small>
                    </button>
                  ))}
                </nav>
              )}
              {(focusId || query.trim()) && (
                <div className="sb-graph-filter-note">
                  <span>{query.trim() ? '搜索：' + query.trim() : '聚焦：' + names.get(focusId)}</span>
                  <B onClick={rootView}>返回主题主干</B>
                </div>
              )}
              {tableMode ? (
                <div className="sb-graph-triples-wrap">
                  <p className="sb-graph-table-count">
                    {projection.edges.length} 条关系，出处列标出引用版本；点击关系词查看具体引用片段。
                  </p>
                  <table className="sb-spo-table">
                    <thead>
                      <tr>
                        <th>主体</th>
                        <th>关系</th>
                        <th>客体</th>
                        <th>出处与性质</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.edges.map((edge) => (
                        <tr key={edge.id}>
                          <td>{names.get(edge.from)}</td>
                          <td>
                            <button onClick={() => setDetail({ kind: 'edge', id: edge.id })}>
                              {edge.label} →
                            </button>
                          </td>
                          <td>{names.get(edge.to)}</td>
                          <td>
                            <span className="sb-graph-basis-tag">{edge.basis}</span>
                            {edge.sourceNumbers.map((number) => {
                              const source = graph.sourceCatalog.find((s) => s.number === number);
                              return (
                                <button
                                  className="sb-graph-table-source"
                                  key={number}
                                  title={[source.boardTitle, source.summaryTitle, graphSourceDate(source)]
                                    .filter(Boolean)
                                    .join(' · ')}
                                  onClick={() => setDetail({ kind: 'edge', id: edge.id })}
                                >
                                  <span>
                                    [{number}] {source.boardTitle || source.summaryTitle}
                                  </span>
                                  <small>
                                    {graphSourceKind(source)}
                                    {source.createdAt ? ' · ' + graphSourceDate(source) : ''}
                                  </small>
                                </button>
                              );
                            })}
                            {!edge.sourceNumbers.length && <small>未附材料出处</small>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!projection.edges.length && <p className="sb-empty">没有符合当前范围的关系。</p>}
                </div>
              ) : (
                <GraphCanvas
                  nodes={projection.nodes}
                  edges={projection.edges}
                  groups={projection.groups}
                  dense={mode === 'full' && projection.edges.length > 12}
                  contextKey={[mapId, branchId, mode, query, focusId].join('/')}
                  onNode={(id) => setDetail({ kind: 'node', id })}
                  onEdge={(id) => setDetail({ kind: 'edge', id })}
                />
              )}
              {visibleSources.length > 0 && (
                <div className="sb-graph-source-catalog" aria-label="当前图谱的来源">
                  <h3>本视图来源</h3>
                  <p>同一材料的不同总结版本分别编号。点击编号查看出处，点击关系查看该条 SPO 的具体引用。</p>
                  {visibleSources.map((source) => (
                    <button key={source.key} onClick={() => setDetail({ kind: 'source', id: source.key })}>
                      <span className="sb-graph-source-number">[{source.number}]</span>
                      <span>
                        <strong>{source.boardTitle || '未命名笔记'}</strong>
                        <small>
                          {graphSourceKind(source)}
                          {source.summaryTitle ? ' · ' + source.summaryTitle : ''}
                          {source.createdAt ? ' · ' + graphSourceDate(source) : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {mode === 'main' && map && !branch && !query && !focusId && (
                <p className="sb-graph-reading-note">
                  主干展示 {projection.nodes.length} 个实体、{projection.edges.length}{' '}
                  条关系。人物、个案与具体路径可在分支或完整图谱中查看。
                </p>
              )}
            </>
          )}
        </>
      )}
      {detail && (
        <GraphDetail
          detail={detail}
          graph={graph}
          triple={triple}
          onClose={() => setDetail(null)}
          onEdge={(id) => setDetail({ kind: 'edge', id })}
          onFocus={(id) => {
            setFocusId(id);
            setBranchId('');
            setQuery('');
            setMode('main');
            setDetail(null);
          }}
          onSource={(source) => {
            setDetail(null);
            onOpen(source.boardId, source.summaryId || undefined, {
              kind: source.kind === 'canvas' ? 'canvas' : 'summary',
              elementIds: source.elementId ? [source.elementId] : [],
              blockId: source.conceptId
                ? 'concept:' + source.conceptId + ':explanation'
                : source.id?.endsWith('/overview')
                  ? 'overview'
                  : null,
              textQuote: source.quote || source.text,
            });
          }}
          onRemove={async (id) => {
            try {
              await api('execute', { action: 'linkConcepts', remove: id });
              setDetail(null);
              await reload();
            } catch (error) {
              onError(error);
            }
          }}
        />
      )}
    </section>
  );
}
function GraphDetail({ detail, graph, triple, onClose, onEdge, onFocus, onSource, onRemove }) {
  const root = useRef(),
    node = detail.kind === 'node' ? graph.nodes.find((n) => n.id === detail.id) : null,
    edge = detail.kind === 'edge' ? graph.edges.find((e) => e.id === detail.id) : null,
    sourceEntry = detail.kind === 'source' ? graph.sourceCatalog.find((s) => s.key === detail.id) : null;
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div className="sb-mask" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="图谱详情"
        className="sb-modal sb-graph-detail-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const elements = [...root.current.querySelectorAll('button:not(:disabled),a[href]')];
            if (event.shiftKey && document.activeElement === elements[0]) {
              event.preventDefault();
              elements.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
              event.preventDefault();
              elements[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{edge ? '关系与出处' : sourceEntry ? '来源与引用版本' : '实体与联系'}</h2>
          <button aria-label="关闭图谱详情" onClick={onClose}>
            ×
          </button>
        </header>
        {edge ? (
          <>
            <div className="sb-spo-triple-title">{triple(edge)}</div>
            <p className="sb-spo-basis">{edge.basis} · 未独立核实</p>
            <p className="sb-graph-detail-stance">
              {edge.sources?.some((s) => s.kind === 'manual')
                ? '这是你手动建立的关系，尚未附具体材料出处。'
                : edge.inferred
                  ? '这条关系由 AI 根据下列来源推断，推断可能不成立。'
                  : '这条关系提取自下列来源中的表述，可能存在误读、偏差或条件遗漏。'}
            </p>
            <p>{edge.explanation}</p>
            {edge.evidence.length > 0 && (
              <>
                <h3>SPO来源</h3>
                {edge.evidence.map((source, i) => (
                  <GraphSourceCard source={source} onSource={onSource} key={source.id + i} />
                ))}
              </>
            )}
            {graph.aiReport && !edge.sources?.some((s) => s.kind === 'manual') && (
              <p className="sb-graph-extraction-meta">
                图谱整理：{graph.aiReport.model || '历史模型'}
                {graph.aiReport.createdAt ? ' · ' + graphSourceDate(graph.aiReport) : ''}
                。引文来自以上笔记或总结片段；原材料链接供你回看核对。
              </p>
            )}
            {edge.sources?.some((s) => s.kind === 'manual') && (
              <B onClick={() => onRemove(edge.id)}>移除手动关系</B>
            )}
          </>
        ) : sourceEntry ? (
          <>
            <p className="sb-spo-basis">
              来源 [{sourceEntry.number}] · {graphSourceKind(sourceEntry)}
            </p>
            <p className="sb-graph-detail-stance">
              {sourceEntry.kind === 'canvas'
                ? '引用的是画布中记录的文字。'
                : '引用的是这一版 AI 总结中的文字，可能已经含有模型的概括、补充或误读。'}
              出处可追溯不等于观点已证实。
            </p>
            <GraphSourceCard source={sourceEntry} onSource={onSource} quote={false} />
            <h3>图谱引用的片段</h3>
            {sourceEntry.passages.map((source, index) => (
              <section className="sb-spo-evidence" key={source.id + index}>
                <small>{source.title}</small>
                <blockquote>{source.quote || source.text}</blockquote>
                <button onClick={() => onSource(source)}>定位到引用位置 ↗</button>
              </section>
            ))}
          </>
        ) : node ? (
          <>
            <span className="sb-eyebrow">{kinds[node.type] || '实体'}</span>
            <h2>{node.title}</h2>
            {node.aliases?.length > 0 && <p>别名：{node.aliases.join('、')}</p>}
            <p className="sb-graph-detail-stance">
              以下说明由所选来源整理，未独立核实。每条联系的出处可在对应 SPO 中查看。
            </p>
            <p>{node.description}</p>
            <B onClick={() => onFocus(node.id)}>只看这个实体的关系</B>
            <h3>相关三元组</h3>
            {graph.edges
              .filter((e) => e.from === node.id || e.to === node.id)
              .map((e) => (
                <button className="sb-spo-relation" key={e.id} onClick={() => onEdge(e.id)}>
                  {triple(e)}
                  <small>
                    {e.basis} · {e.sourceLabel}
                  </small>
                </button>
              ))}
          </>
        ) : (
          <p>这项关系的来源已变化，请重新整理图谱。</p>
        )}
      </section>
    </div>
  );
}
