export function graphSourceKey(source) {
  return [
    source.boardId || source.id,
    source.kind === 'canvas' ? 'canvas' : source.summaryId || source.id,
  ].join('/');
}
export function graphSourceKind(source) {
  return source.kind === 'canvas'
    ? '画布笔记'
    : source.summaryId || source.kind === 'summary'
      ? 'AI 总结'
      : '来源记录';
}
export function graphSourceDate(source) {
  const date = new Date(source.createdAt);
  return source.createdAt && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}
export function graphSourceUrl(source) {
  try {
    const url = new URL(source.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function graphBasis(edge) {
  if (edge.sources?.some((s) => s.kind === 'manual')) return '手动关系';
  if (edge.inferred) return 'AI 推断';
  const kinds = new Set((edge.evidence || []).map(graphSourceKind));
  return kinds.size === 1 ? [...kinds][0] + '提取' : '来源提取';
}
export function withGraphProvenance(graph) {
  const catalog = new Map();
  const add = (source) => {
    const key = graphSourceKey(source);
    if (!catalog.has(key)) catalog.set(key, { ...source, key, number: catalog.size + 1, passages: [] });
    const entry = catalog.get(key);
    if (!entry.passages.some((s) => s.id === source.id && s.quote === source.quote))
      entry.passages.push(source);
    return entry.number;
  };
  for (const edge of graph.edges || []) for (const source of edge.evidence || []) add(source);
  for (const map of graph.maps || [])
    for (const claim of [map.takeaway, ...(map.branches || []).map((b) => b.summary)])
      for (const source of claim?.evidence || []) add(source);
  const edges = (graph.edges || []).map((edge) => {
    const sourceNumbers = [...new Set((edge.evidence || []).map(add))];
    return {
      ...edge,
      basis: graphBasis(edge),
      sourceNumbers,
      sourceLabel: sourceNumbers.length
        ? sourceNumbers
            .slice(0, 3)
            .map((n) => '[' + n + ']')
            .join(' ') + (sourceNumbers.length > 3 ? ' +' + (sourceNumbers.length - 3) : '')
        : '手动',
    };
  });
  return { ...graph, edges, sourceCatalog: [...catalog.values()] };
}
