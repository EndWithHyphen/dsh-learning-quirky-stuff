import { Graph } from 'dagre-d3-es/src/graphlib/graph.js';
import { layout as dagreLayout } from 'dagre-d3-es/src/dagre/layout.js';

export function graphTextLines(text, limit = 10, max = 2) {
  const chars = Array.from(String(text || '')),
    lines = [];
  while (chars.length && lines.length < max) lines.push(chars.splice(0, limit).join(''));
  if (chars.length) lines[lines.length - 1] = lines.at(-1).slice(0, -1) + '…';
  return lines.length ? lines : [''];
}
export function layeredGraph(nodes, edges, requestedGroups = [], availableWidth = 900) {
  const viewport = Math.max(640, Math.min(1080, Math.round(availableWidth) || 900));
  if (!nodes.length) return { width: viewport, height: 220, nodes: [], edges: [], groups: [] };
  const graph = new Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 28, edgesep: 16, ranksep: 38, marginx: 22, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  const groups = new Map(requestedGroups.flatMap((group) => group.entityIds.map((id) => [id, group.title])));
  const preferred = requestedGroups.flatMap((group) => group.entityIds);
  const ordered = [...nodes].sort((a, b) => {
    const ai = preferred.indexOf(a.id),
      bi = preferred.indexOf(b.id);
    return (ai < 0 ? preferred.length : ai) - (bi < 0 ? preferred.length : bi);
  });
  for (const node of ordered) graph.setNode(node.id, { width: 174, height: 70 });
  const labels = new Map();
  for (const edge of edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    const lines = graphTextLines(edge.label, 11, 2);
    const width = Math.max(
      48,
      Math.max(
        ...lines.map((line) =>
          Array.from(line).reduce((sum, ch) => sum + (/[\u0000-\u00ff]/.test(ch) ? 7 : 13), 0),
        ),
      ) + 16,
    );
    const sourceLine = edge.sourceLabel || '';
    const height = lines.length * 17 + 8 + (sourceLine ? 17 : 0);
    labels.set(edge.id, { width: Math.max(width, sourceLine.length * 6 + 16), height, lines, sourceLine });
    graph.setEdge(edge.from, edge.to, { width: labels.get(edge.id).width, height, labelpos: 'c' }, edge.id);
  }
  dagreLayout(graph);
  const width = Math.max(viewport, graph.graph().width),
    height = Math.max(250, graph.graph().height),
    offsetX = (width - graph.graph().width) / 2,
    offsetY = (height - graph.graph().height) / 2;
  const placed = nodes.map((node) => ({
    ...node,
    ...graph.node(node.id),
    x: graph.node(node.id).x + offsetX,
    y: graph.node(node.id).y + offsetY,
    groupTitle: groups.get(node.id) || '',
  }));
  const routed = edges
    .filter((edge) => labels.has(edge.id))
    .map((edge) => {
      const position = graph.edge({ v: edge.from, w: edge.to, name: edge.id }),
        label = labels.get(edge.id),
        points = position.points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
      return {
        ...edge,
        relationLabel: edge.label,
        points,
        path: points.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join(' '),
        center: { x: position.x + offsetX, y: position.y + offsetY },
        label: {
          ...label,
          x: position.x + offsetX - label.width / 2,
          y: position.y + offsetY - label.height / 2,
        },
      };
    });
  return { width, height, nodes: placed, edges: routed, groups: [] };
}

export function graphProjection(
  graph,
  { mapId = '', branchId = '', mode = 'main', query = '', focusId = '' } = {},
) {
  const map = graph.maps?.find((m) => m.id === mapId),
    branch = map?.branches.find((b) => b.id === branchId),
    topicIds = new Set(map?.topicIds || (mapId && mapId !== 'all' ? [mapId] : []));
  let nodes = graph.nodes.filter((n) => !topicIds.size || n.topicIds?.some((id) => topicIds.has(id))),
    ids = new Set(nodes.map((n) => n.id)),
    edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    groups = [];
  const q = query.trim().normalize('NFKC').toLowerCase();
  if (q) {
    const hits = new Set(
      nodes
        .filter((n) => [n.title, ...(n.aliases || [])].join(' ').normalize('NFKC').toLowerCase().includes(q))
        .map((n) => n.id),
    );
    edges = edges.filter(
      (e) => hits.has(e.from) || hits.has(e.to) || e.label.normalize('NFKC').toLowerCase().includes(q),
    );
    ids = new Set([...hits, ...edges.flatMap((e) => [e.from, e.to])]);
    nodes = nodes.filter((n) => ids.has(n.id));
  } else if (focusId) {
    edges = edges.filter((e) => e.from === focusId || e.to === focusId);
    ids = new Set([focusId, ...edges.flatMap((e) => [e.from, e.to])]);
    nodes = nodes.filter((n) => ids.has(n.id));
  } else if (mode === 'main' && map) {
    const wanted = new Set(branch?.tripleIds || map.coreTripleIds),
      members = new Set(
        branch ? edges.filter((e) => wanted.has(e.id)).flatMap((e) => [e.from, e.to]) : map.coreEntityIds,
      );
    edges = edges.filter(
      (e) =>
        wanted.has(e.id) ||
        (e.sources?.some((s) => s.kind === 'manual') && members.has(e.from) && members.has(e.to)),
    );
    ids = new Set(edges.flatMap((e) => [e.from, e.to]));
    nodes = nodes.filter((n) => ids.has(n.id));
    groups = branch?.groups || map.groups;
  } else {
    ids = new Set(edges.flatMap((e) => [e.from, e.to]));
    nodes = nodes.filter((n) => ids.has(n.id));
  }
  return { nodes, edges, groups, map, branch };
}
