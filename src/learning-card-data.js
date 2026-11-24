import { normalizeConcept } from './learning-layout.js';
import { widgetMeta, ownedCardElements, isQuoteCard, readQuoteValues } from '../shared/canvas-quotes.js';
export { widgetMeta, ownedCardElements, isQuoteCard };
export function convertibleQuoteSelection(api, root) {
  if (!api) return null;
  const state = api.getAppState();
  if (state.viewModeEnabled) return null;
  const editing = state.editingTextElement;
  const ids = editing
    ? [editing.id]
    : Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]);
  if (ids.length !== 1) return null;
  const element = api.getSceneElements().find((e) => e.id === ids[0]);
  if (
    !element ||
    element.type !== 'text' ||
    element.isDeleted ||
    element.locked ||
    element.containerId ||
    widgetMeta(element).role ||
    widgetMeta(element).widgetId
  )
    return null;
  const raw = element.originalText ?? element.text;
  if (!editing) return raw?.trim() ? { element, text: raw, partial: false } : null;
  const editor = root?.querySelector('textarea.excalidraw-wysiwyg');
  if (!editor || editor.selectionStart === editor.selectionEnd) return null;
  const start = editor.selectionStart,
    end = editor.selectionEnd;
  const partial = start !== 0 || end !== editor.value.length;
  let text = editor.value.slice(start, end);
  // Textareas normalize line endings. Map their offsets back to the stored source when it still matches.
  if (raw?.includes('\r') && raw.replace(/\r\n?/g, '\n') === editor.value) {
    const offsets = [0];
    for (let i = 0; i < raw.length; ) {
      i += raw.startsWith('\r\n', i) ? 2 : 1;
      offsets.push(i);
    }
    text = raw.slice(offsets[start], offsets[end]);
  }
  return text.trim() ? { element, text, partial, editor } : null;
}

export function quoteFromSelection(elements, selectedIds) {
  const texts = elements.filter(
    (e) => selectedIds[e.id] && !e.isDeleted && e.type === 'text' && widgetMeta(e).role !== 'pdf-source',
  );
  if (texts.length !== 1) return null;
  const [element] = texts;
  const reference = widgetMeta(element).pdfSource;
  return {
    text: element.originalText ?? element.text,
    source:
      reference?.title && reference.page
        ? `${reference.title} · 第 ${reference.page} 页`
        : widgetMeta(element).webSource?.title || '',
  };
}
export function readCardValues(owner, elements) {
  if (isQuoteCard(owner)) return readQuoteValues(owner, elements);
  const data = widgetMeta(owner),
    values = structuredClone(data.values || {}),
    steps = String(values.steps || '')
      .split('\n')
      .filter(Boolean);
  const concept = data.widget === 'concept';
  const extras = [];
  for (const e of ownedCardElements(owner, elements)) {
    if (e.type !== 'text' || e.isDeleted) continue;
    const field = widgetMeta(e).field,
      text = e.originalText ?? e.text;
    if (!field) {
      if (e.containerId === owner.id && !widgetMeta(e).widgetId && text?.trim()) extras.push(text);
      continue;
    }
    if (e.text === widgetMeta(e).renderedText) continue;
    if (field.startsWith('step:')) steps[Number(field.slice(5))] = text;
    else if (concept && field.startsWith('point:')) {
      const match = field.match(/^point:(.*):(title|body)$/),
        item = match && values.items?.find((v) => v.id === match[1]);
      if (item) item[match[2]] = text;
    } else values[field] = text;
  }
  if (data.widget === 'steps') values.steps = steps.join('\n');
  if (!concept) return values;
  const result = normalizeConcept(values);
  if (extras.length) {
    if (!result.items.length) result.items.push({ id: 'recovered', title: '', body: '' });
    result.items[0].body = [result.items[0].body, ...extras].filter(Boolean).join('\n');
  }
  return result;
}
export function cardAtPoint(elements, point) {
  return [...elements].reverse().find((e) => {
    if (e.isDeleted || e.locked || widgetMeta(e).role !== 'background' || !widgetMeta(e).widget) return false;
    const cx = e.x + e.width / 2,
      cy = e.y + e.height / 2,
      a = -(e.angle || 0);
    const dx = point.x - cx,
      dy = point.y - cy;
    return (
      Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= e.width / 2 &&
      Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= e.height / 2
    );
  });
}
