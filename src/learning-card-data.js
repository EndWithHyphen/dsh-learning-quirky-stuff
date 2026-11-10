import { normalizeConcept } from './learning-layout.js';
export const widgetMeta = (element) => element?.customData?.studyboard || {};
export function ownedCardElements(owner, elements) {
  const data = widgetMeta(owner),
    group = owner.groupIds?.find((id) => id === data.groupId) || owner.groupIds?.[0];
  return elements.filter(
    (e) =>
      e.id === owner.id ||
      (group && e.groupIds?.includes(group) && widgetMeta(e).widgetId === (data.widgetId || owner.id)) ||
      (data.widget === 'concept' && e.type === 'text' && e.containerId === owner.id),
  );
}
export function readCardValues(owner, elements) {
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
