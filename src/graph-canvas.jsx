import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { layeredGraph, graphTextLines } from './graph-layout.js';
const kinds = {
  person: '人物',
  organization: '组织',
  group: '群体',
  concept: '概念',
  policy: '政策',
  event: '事件',
};
export default function GraphCanvas({ nodes, edges, groups, onNode, onEdge, dense = false, contextKey }) {
  const root = useRef(),
    [width, setWidth] = useState(880),
    [zoom, setZoom] = useState(null),
    [hover, setHover] = useState(''),
    marker = useId().replace(/:/g, '');
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const value = entries[0]?.contentRect.width;
      if (value) setWidth(value);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setZoom(null);
    setHover('');
    if (root.current) {
      root.current.scrollLeft = 0;
      root.current.scrollTop = 0;
    }
  }, [contextKey]);
  const layout = useMemo(() => layeredGraph(nodes, edges, groups, width), [nodes, edges, groups, width]);
  const defaultScale = Math.max(0.88, Math.min(1, width / layout.width)),
    scale = zoom ?? defaultScale;
  return (
    <div className="sb-graph-canvas-box">
      <div className="sb-graph-zoom">
        <span>
          {nodes.length} 个实体 · {edges.length} 条关系
        </span>
        <button
          aria-label="缩小图谱"
          onClick={() => setZoom((z) => Math.max(0.65, (z ?? defaultScale) - 0.15))}
        >
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          aria-label="放大图谱"
          onClick={() => setZoom((z) => Math.min(1.75, (z ?? defaultScale) + 0.15))}
        >
          ＋
        </button>
        <button onClick={() => setZoom(1)}>原始大小</button>
        <button onClick={() => setZoom(Math.max(0.6, Math.min(1, width / layout.width)))}>适应宽度</button>
      </div>
      <div className="sb-graph-viewport" ref={root}>
        {!nodes.length ? (
          <p className="sb-graph-no-match">当前范围没有匹配的实体或关系。</p>
        ) : (
          <svg
            className="sb-graph-layered"
            width={layout.width * scale}
            height={layout.height * scale}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="主题主干与分支关系图"
          >
            <defs>
              <marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0 0 L7 3.5 L0 7" fill="var(--sb-accent)" />
              </marker>
            </defs>
            {layout.groups.map((g, i) =>
              g.title ? (
                <text
                  key={i}
                  x={g.x}
                  y="26"
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="600"
                  fill="var(--sb-muted)"
                >
                  {g.title}
                </text>
              ) : null,
            )}
            {layout.edges.map((e) => (
              <g
                className="sb-spo-edge"
                key={e.id}
                role="button"
                tabIndex="0"
                aria-label={`${nodes.find((n) => n.id === e.from)?.title}—${e.relationLabel}→${nodes.find((n) => n.id === e.to)?.title} · ${e.basis || ''} · 来源 ${e.sourceLabel || '未附出处'}`}
                onClick={() => onEdge(e.id)}
                onKeyDown={(event) => {
                  if (['Enter', ' '].includes(event.key)) {
                    event.preventDefault();
                    onEdge(e.id);
                  }
                }}
                onMouseEnter={() => setHover(e.id)}
                onMouseLeave={() => setHover('')}
                onFocus={() => setHover(e.id)}
                onBlur={() => setHover('')}
              >
                <path d={e.path} fill="none" stroke="transparent" strokeWidth="15" />
                <path
                  d={e.path}
                  fill="none"
                  stroke="var(--sb-accent)"
                  strokeOpacity={hover && hover !== e.id ? 0.35 : 0.72}
                  strokeWidth={hover === e.id ? 2.5 : 1.5}
                  strokeLinejoin="round"
                  strokeDasharray={e.inferred ? '5 4' : undefined}
                  markerEnd={`url(#${marker})`}
                />
                {(!dense || hover === e.id) && (
                  <g className="sb-graph-edge-label">
                    <rect
                      x={e.label.x}
                      y={e.label.y}
                      width={e.label.width}
                      height={e.label.height}
                      rx="5"
                      fill="var(--sb-bg)"
                      stroke="var(--sb-line)"
                    />
                    <text
                      x={e.label.x + e.label.width / 2}
                      y={e.label.y + 17}
                      textAnchor="middle"
                      fontSize="13"
                      fill="var(--sb-ink)"
                    >
                      {e.label.lines.map((line, i) => (
                        <tspan x={e.label.x + e.label.width / 2} dy={i ? 17 : 0} key={i}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {e.label.sourceLine && (
                      <text
                        x={e.label.x + e.label.width / 2}
                        y={e.label.y + 17 * e.label.lines.length + 15}
                        textAnchor="middle"
                        fontSize="10"
                        fill="var(--sb-muted)"
                      >
                        {e.label.sourceLine}
                      </text>
                    )}
                  </g>
                )}
                <title>
                  {e.relationLabel +
                    ' · ' +
                    e.basis +
                    ' · 来源 ' +
                    e.sourceLabel +
                    ' · ' +
                    (e.explanation || '手动关系')}
                </title>
              </g>
            ))}
            {layout.nodes.map((n) => {
              const lines = graphTextLines(n.title, Math.max(6, Math.floor((n.width - 20) / 16)), 2);
              return (
                <g
                  className="sb-spo-node"
                  key={n.id}
                  role="button"
                  tabIndex="0"
                  aria-label={n.title + '，' + (kinds[n.type] || '实体')}
                  onClick={() => onNode(n.id)}
                  onKeyDown={(event) => {
                    if (['Enter', ' '].includes(event.key)) {
                      event.preventDefault();
                      onNode(n.id);
                    }
                  }}
                >
                  <rect
                    x={n.x - n.width / 2}
                    y={n.y - n.height / 2}
                    width={n.width}
                    height={n.height}
                    rx="10"
                    fill="var(--sb-panel)"
                    stroke="var(--sb-line)"
                  />
                  <text x={n.x} y={n.y - 20} fontSize="10" textAnchor="middle" fill="var(--sb-muted)">
                    {graphTextLines(n.groupTitle || kinds[n.type] || '实体', 18, 1)[0]}
                  </text>
                  <text
                    x={n.x}
                    y={n.y + 7 - (lines.length - 1) * 8}
                    textAnchor="middle"
                    fontSize="16"
                    fontWeight="600"
                    fill="var(--sb-ink)"
                  >
                    {lines.map((line, i) => (
                      <tspan key={i} x={n.x} dy={i ? 18 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <title>{n.title}</title>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="sb-graph-canvas-hint">
        关系旁的 [编号] 对应下方来源；点击关系查看引用片段。虚线表示 AI 推断，实线也不代表已核实。
        {dense ? '完整图较密，悬停或聚焦连线显示关系词。' : ''}
        {layout.width * scale > width + 2 ? '图较宽时可横向滚动，或点「适应宽度」。' : ''}
      </p>
    </div>
  );
}
