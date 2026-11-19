export const widgetMeta = (element) => element?.customData?.studyboard || {};

export function isQuoteCard(element) {
  const data = widgetMeta(element);
  return !element.isDeleted && data.role === 'background' && data.widget === 'quote';
}

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

export function readQuoteValues(owner, elements) {
  const stored = widgetMeta(owner).values;
  const values = {
    text: typeof stored?.text === 'string' ? stored.text : '',
    source: typeof stored?.source === 'string' ? stored.source : '',
  };
  for (const child of ownedCardElements(owner, elements)) {
    const { field, renderedText } = widgetMeta(child);
    if (child.isDeleted || child.type !== 'text' || child.text === renderedText) continue;
    const original = child.originalText ?? child.text;
    if ((field === 'text' || field === 'source') && typeof original === 'string') values[field] = original;
  }
  return values;
}

export function canvasQuotes(elements) {
  const owners = elements.filter(isQuoteCard);
  if (!owners.length) return [];
  const editedFields = new Map();
  for (const child of elements) {
    const { widgetId, field, renderedText } = widgetMeta(child);
    if (!widgetId || (field !== 'text' && field !== 'source') || child.text === renderedText) continue;
    if (!editedFields.has(widgetId)) editedFields.set(widgetId, []);
    editedFields.get(widgetId).push(child);
  }
  return owners
    .map((owner) => ({
      id: owner.id,
      ...readQuoteValues(owner, editedFields.get(widgetMeta(owner).widgetId || owner.id) || []),
    }))
    .filter((quote) => quote.text.trim());
}
