export function diagramLines(text, max = 12) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    line += ch;
    if (line.length >= max) {
      out.push(line);
      line = '';
    }
  }
  if (line) out.push(line);
  return out;
}
export function diagramLayout(diagram) {
  const nodes = diagram.nodes,
    edges = diagram.edges || [],
    boxWidth = 220;
  if (diagram.kind === 'cycle' && nodes.length > 2) {
    const width = 800,
      height = 700;
    return {
      width,
      height,
      nodes: nodes.map((n, i) => ({
        ...n,
        x: width / 2 + 275 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / nodes.length),
        y: height / 2 + 245 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / nodes.length),
        width: 200,
        height: Math.max(76, diagramLines(n.label, 11).length * 24 + 26),
      })),
    };
  }
  const levels = new Map(nodes.map((n) => [n.id, 0])),
    inbound = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges)
    if (inbound.has(edge.to) && inbound.has(edge.from)) inbound.set(edge.to, inbound.get(edge.to) + 1);
  const queue = nodes.filter((n) => inbound.get(n.id) === 0).map((n) => n.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited++;
    for (const edge of edges.filter((e) => e.from === id && inbound.has(e.to))) {
      levels.set(edge.to, Math.max(levels.get(edge.to), levels.get(id) + 1));
      inbound.set(edge.to, inbound.get(edge.to) - 1);
      if (inbound.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  if (!edges.length || visited !== nodes.length) nodes.forEach((n, i) => levels.set(n.id, Math.floor(i / 2)));
  const ranks = [...new Set(levels.values())].sort((a, b) => a - b),
    rows = [];
  for (const rank of ranks) {
    const members = nodes.filter((n) => levels.get(n.id) === rank);
    for (let i = 0; i < members.length; i += 3) rows.push(members.slice(i, i + 3));
  }
  const width = Math.max(520, Math.max(...rows.map((r) => r.length)) * 250 + 40),
    placed = [];
  let y = 26;
  for (const row of rows) {
    const height = Math.max(...row.map((n) => Math.max(76, diagramLines(n.label).length * 24 + 26)));
    row.forEach((node, i) =>
      placed.push({
        ...node,
        x: (width - row.length * 250) / 2 + 125 + i * 250,
        y: y + height / 2,
        width: boxWidth,
        height,
      }),
    );
    y += height + 110;
  }
  return { width, height: y - 80, nodes: placed };
}
