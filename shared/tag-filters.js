const normalized = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
const names = new Intl.Collator('zh', { numeric: true });

export function tagIndex(notes) {
  const counts = new Map();
  for (const note of notes)
    for (const name of new Set(note.tags || [])) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

export function findTags(entries, query = '', order = 'usage') {
  const term = normalized(query).replace(/^#+/, '').trim();
  return entries
    .filter(({ name }) => normalized(name).includes(term))
    .sort((a, b) => (order === 'usage' ? b.count - a.count : 0) || names.compare(a.name, b.name));
}

export function matchesTags(note, selected = [], mode = 'all') {
  if (!selected.length) return true;
  const tags = new Set(note.tags || []);
  return mode === 'any' ? selected.some((name) => tags.has(name)) : selected.every((name) => tags.has(name));
}

export function matchesNoteQuery(note, query = '') {
  const term = normalized(query);
  return (
    !term ||
    normalized(
      [note.title, ...(note.tags || []), note.textIndex, note.summaryText].filter(Boolean).join(' '),
    ).includes(term)
  );
}
