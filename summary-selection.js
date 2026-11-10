export const activeSummaries = (board) => (board.summaries || []).filter((s) => !s.deletedAt);
export function summaryScopeKey(summary, all) {
  const seen = new Set();
  let current = summary;
  while (current.parentSummaryId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = all.find((s) => s.id === current.parentSummaryId);
    if (!parent) break;
    current = parent;
  }
  return current.scope === 'selection'
    ? 'selection:' + JSON.stringify([...(current.elementIds || [])].sort())
    : 'board';
}
export function graphSummaries(board, includeHistory = false) {
  const all = board.summaries || [],
    active = activeSummaries(board);
  if (includeHistory) return active;
  const latest = new Map();
  for (const s of active.filter((s) => s.kind !== 'expand')) latest.set(summaryScopeKey(s, all), s);
  const keep = new Set([...latest.values()].map((s) => s.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of active.filter((s) => s.kind === 'expand')) {
      const parent = all.find((v) => v.id === s.parentSummaryId);
      if (!keep.has(s.id) && (keep.has(s.parentSummaryId) || !parent || parent.deletedAt)) {
        keep.add(s.id);
        changed = true;
      }
    }
  }
  return active.filter((s) => keep.has(s.id));
}
