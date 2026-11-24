import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite, validateScene } from '../core.js';
import { layoutCanvasText, layoutLearningCard, learningCardSkeleton } from '../shared/learning-layout.js';
import { checkWebNoteSource, nextWebCanvasPosition, webCanvasElement } from '../web-notes.js';
import { publicUrl } from './lib/values.js';

function selectionElements(board, kind, elementId, values, sourceUrl) {
  // Leave room for full-width glyphs when laying out a card without a browser canvas.
  const measure = (line, size) =>
    Array.from(line).reduce(
      (w, c) => w + (c === ' ' ? 0.35 : /^[a-z0-9]$/i.test(c) && !/[WMwm]/.test(c) ? 0.73 : 1),
      0,
    ) * size;
  const origin = nextWebCanvasPosition(board.scene);
  if (kind === 'excerpt')
    return [
      webCanvasElement({
        ...layoutCanvasText(values.text, 480, 20, measure, true),
        ...origin,
        id: elementId,
        strokeColor: '#24382c',
        link: sourceUrl,
        customData: { studyboard: { webSource: { title: values.source } } },
      }),
    ];
  const layout = layoutLearningCard('quote', values, { width: 480, height: 0 }, 1, measure);
  return learningCardSkeleton(
    layout,
    origin,
    { kind: 'quote', ownerId: elementId, values, sourceUrl, scale: 1 },
    randomUUID(),
  ).map(webCanvasElement);
}

export async function captureWebSelection(capture, request, kind) {
  const { text, requestId, reuseId } = request;
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先选中网页上的文字');
  if (text.length > 6000) throw new Error('单条摘录最多 6000 个字符，请缩短选区');
  const url = publicUrl(request.url),
    sourceUrl = publicUrl(request.sourceUrl || url);
  if (sourceUrl.length > 10000) throw new Error('来源链接过长');
  const note = await capture.capture({ requestId, title: request.title, url, reuseId, reuse: true });
  if (note.url !== url || (reuseId && reuseId !== note.id)) throw new Error('摘录与网页笔记的绑定不一致');
  const hash = createHash('sha256').update(requestId).digest('hex').slice(0, 32);
  const elementId = kind + '-' + hash;
  const store = capture.store;
  return store.serial(async () => {
    const board = await store.read(note.id);
    checkWebNoteSource(board, url);
    const receipts = (board.webQuoteReceipts ||= []);
    if (receipts.includes((kind === 'quote' ? 'excerpt-' : 'quote-') + hash))
      throw new Error('这条摘录已按另一种方式保存');
    // A replay must not recreate an excerpt after it is edited, converted to a quote, or removed.
    if (!receipts.includes(elementId)) {
      const source =
        (typeof request.title === 'string' && request.title.trim()) ||
        board.source.title ||
        new URL(sourceUrl).hostname;
      const elements = selectionElements(
        board,
        kind,
        elementId,
        { text, source: source.slice(0, 120) },
        sourceUrl,
      );
      board.scene = validateScene({ ...board.scene, elements: [...board.scene.elements, ...elements] });
      receipts.push(elementId);
      board.revision++;
      board.updatedAt = new Date().toISOString();
      await atomicWrite(store.boardPath(board.id), board);
    }
    return {
      ...note,
      elementId,
      ...(kind === 'quote' ? { quoteId: elementId } : {}),
      revision: board.revision,
    };
  });
}
