import { wrapLearningText, findLearningSpace } from './learning-layout.js';

export function plainCanvasText(e) {
  return (
    e.type === 'text' &&
    !e.isDeleted &&
    !e.locked &&
    !e.containerId &&
    !e.groupIds?.length &&
    !e.angle &&
    !Object.keys(e.customData?.studyboard || {}).length
  );
}
export function readableTextWidth(e, viewportWidth = 900) {
  return Math.min(840, Math.max(280, viewportWidth - 80), Math.max(320, (e.fontSize || 20) * 32));
}
export function longCanvasText(e, viewportWidth) {
  return plainCanvasText(e) && e.width > readableTextWidth(e, viewportWidth) * 1.3;
}
export function wrapCanvasText(e, elements, viewportWidth, measure) {
  if (!longCanvasText(e, viewportWidth)) return null;
  const width = readableTextWidth(e, viewportWidth),
    originalText = e.originalText || e.text,
    text = wrapLearningText(originalText, width, e.fontSize, measure),
    height = Math.max(1, text.split('\n').length) * e.fontSize * (e.lineHeight || 1.25),
    x =
      e.x +
      (e.textAlign === 'center' ? (e.width - width) / 2 : e.textAlign === 'right' ? e.width - width : 0),
    area = findLearningSpace(
      { x, y: e.y, width, height },
      elements.filter(
        (other) => other.id !== e.id && !other.isDeleted && other.type !== 'frame' && !other.locked,
      ),
      20,
    );
  return { ...area, text, originalText, autoResize: false };
}
