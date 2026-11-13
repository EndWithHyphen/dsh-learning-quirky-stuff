import { Graph } from 'dagre-d3-es/src/graphlib/graph.js';
import { layout as dagreLayout } from 'dagre-d3-es/src/dagre/layout.js';

const units = (text) =>
  [...String(text || '')].reduce(
    (n, ch) =>
      n +
      (/[WM@#%]/.test(ch)
        ? 0.9
        : /[A-Z]/.test(ch)
          ? 0.68
          : /[a-z0-9]/.test(ch)
            ? 0.56
            : /\s/.test(ch)
              ? 0.3
              : /[\u0000-\u007f、，。；：！？]/.test(ch)
                ? 0.5
                : 1),
    0,
  );
export function diagramLines(text, max = 12) {
  const out = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n') {
      if (line) out.push(line);
      line = '';
      continue;
    }
    if (line && units(line + ch) > max && !/[、，。；：！？）】》]/.test(ch)) {
      out.push(line.trim());
      line = '';
    }
    line += ch;
  }
  if (line.trim()) out.push(line.trim());
  return out.length ? out : [''];
}

/** Compact geometry is shared by the reading view and editable canvas export. */
export function diagramLayout(diagram, { availableWidth = 800, fontSize = 14 } = {}) {
  const lineHeight = Math.ceil(fontSize * 1.4),
    edgeFontSize = Math.max(11, Math.round(fontSize * 0.8)),
    edgeLineHeight = edgeFontSize + 4;
  const nodes = (diagram.nodes || []).map((node) => {
    const lines = diagramLines(node.label, 12);
    return {
      ...node,
      lines,
      fontSize,
      lineHeight,
      width: Math.max(88, Math.ceil(Math.max(...lines.map(units)) * fontSize) + 28),
      height: Math.max(44, lines.length * lineHeight + 20),
    };
  });
  const ids = new Set(nodes.map((n) => n.id)),
    edges = (diagram.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const limit = Math.max(180, Number(availableWidth) || 800);
  if (!nodes.length) return { width: 0, height: 0, nodes: [], edges: [], direction: 'TB' };
  if (!edges.length) {
    const gap = 20,
      columns = Math.max(
        1,
        Math.min(
          3,
          nodes.length,
          Math.floor((limit - 24 + gap) / (Math.max(...nodes.map((n) => n.width)) + gap)),
        ),
      );
    const rows = [];
    for (let i = 0; i < nodes.length; i += columns) rows.push(nodes.slice(i, i + columns));
    const width =
      Math.max(...rows.map((row) => row.reduce((n, p) => n + p.width, 0) + (row.length - 1) * gap)) + 24;
    let y = 12;
    const placed = [];
    for (const row of rows) {
      const height = Math.max(...row.map((n) => n.height));
      let x = (width - row.reduce((n, p) => n + p.width, 0) - (row.length - 1) * gap) / 2;
      for (const n of row) {
        placed.push({ ...n, x: x + n.width / 2, y: y + height / 2 });
        x += n.width + gap;
      }
      y += height + gap;
    }
    return { width, height: y - gap + 12, nodes: placed, edges: [], direction: 'grid' };
  }
  const make = (direction) => {
    const graph = new Graph({ multigraph: true });
    graph.setGraph({ rankdir: direction, nodesep: 24, edgesep: 18, ranksep: 24, marginx: 12, marginy: 12 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) graph.setNode(n.id, { width: n.width, height: n.height });
    const labels = edges.map((e) => {
      const lines = diagramLines(e.label, direction === 'LR' ? 6 : 12);
      return {
        lines,
        width: e.label ? Math.ceil(Math.max(...lines.map(units)) * edgeFontSize) + 12 : 0,
        height: e.label ? lines.length * edgeLineHeight + 8 : 0,
      };
    });
    edges.forEach((e, i) =>
      graph.setEdge(
        e.from,
        e.to,
        { width: labels[i].width, height: labels[i].height, labelpos: 'c', labeloffset: 0 },
        String(i),
      ),
    );
    dagreLayout(graph);
    return {
      width: graph.graph().width,
      height: graph.graph().height,
      direction,
      nodes: nodes.map((n) => ({ ...n, x: graph.node(n.id).x, y: graph.node(n.id).y })),
      edges: edges.map((e, i) => {
        const placed = graph.edge({ v: e.from, w: e.to, name: String(i) });
        return {
          ...e,
          points: placed.points,
          label: {
            ...labels[i],
            x: placed.x,
            y: placed.y,
            fontSize: edgeFontSize,
            lineHeight: edgeLineHeight,
          },
        };
      }),
    };
  };
  const horizontal = make('LR');
  // Prefer a readable horizontal chain when it fits, otherwise keep its natural
  // compact vertical size. Never inflate a small diagram to fill the page.
  return horizontal.width <= limit * 1.03 && diagram.kind !== 'hierarchy' && diagram.kind !== 'cycle'
    ? horizontal
    : make('TB');
}
