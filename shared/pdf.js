export const PDF_CHUNK_BYTES = 512 * 1024;
export const PDF_MAX_BYTES = 128 * 1024 * 1024;
export function pdfReference(document, annotation) {
  const points = annotation.points || [],
    rects = annotation.rects?.length
      ? annotation.rects
      : points.length
        ? [
            [
              Math.min(...points.map((p) => p[0])) - 12,
              Math.min(...points.map((p) => p[1])) - 12,
              Math.max(...points.map((p) => p[0])) + 12,
              Math.max(...points.map((p) => p[1])) + 12,
            ],
          ]
        : [];
  return {
    documentId: document.id,
    title: document.name,
    page: annotation.page,
    pageLabel: annotation.pageLabel || String(annotation.page),
    rects,
    ...(annotation.id ? { annotationId: annotation.id } : {}),
    ...(annotation.kind === 'ink' && annotation.noteId ? { noteId: annotation.noteId } : {}),
    quote: annotation.quote || '',
    origin: annotation.kind === 'ink' ? 'note' : annotation.origin === 'ocr' ? 'ocr' : 'pdf',
  };
}
export function pdfCommentElement(document, annotation) {
  return {
    id: annotation.id,
    type: 'pdf-region',
    text: annotation.quote || '',
    points: annotation.points || [],
    isDeleted: !!annotation.deletedAt,
    pdfSource: pdfReference(document, annotation),
    ...(annotation.note ? { userNote: annotation.note } : {}),
  };
}
export function normalizePdfText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .normalize('NFKC');
}
export function elementPdfReference(element) {
  const reference = element.pdfSource || element.customData?.studyboard?.pdfSource;
  if (!reference) return null;
  const edited =
    element.customData?.studyboard?.role === 'pdf-excerpt' &&
    normalizePdfText(element.originalText || element.text) !== normalizePdfText(reference.quote);
  return edited ? { ...reference, edited: true } : reference;
}
export function validPdfRect(rect) {
  return (
    Array.isArray(rect) &&
    rect.length === 4 &&
    rect.every((n) => Number.isFinite(n) && Math.abs(n) < 1e6) &&
    rect[2] > rect[0] &&
    rect[3] > rect[1]
  );
}
export function pdfSelectionText(items, rects) {
  return items
    .filter((item) =>
      rects.some((r) => {
        const b = item.rect;
        return (
          b && Math.min(b[2], r[2]) > Math.max(b[0], r[0]) && Math.min(b[3], r[3]) > Math.max(b[1], r[1])
        );
      }),
    )
    .map((item) => item.text + (item.eol ? '\n' : ' '))
    .join('')
    .trim();
}
