import { getDocument, PDFWorker, PDFDataRangeTransport, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDF_CHUNK_BYTES } from '../../shared/pdf.js';
export { TextLayer };
const assets = new Map();
export const decode64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export function encode64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
async function asset(execute, name) {
  if (!assets.has(name))
    assets.set(
      name,
      execute({ action: 'pdf.asset', name })
        .then((r) => decode64(r.data))
        .catch((error) => {
          assets.delete(name);
          throw error;
        }),
    );
  return (await assets.get(name)).slice();
}
export async function openPdf(execute, noteId, document, onPassword, onFailure, signal) {
  signal?.throwIfAborted();
  const workerBytes = await asset(execute, 'pdf.worker.min.mjs');
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob([workerBytes], { type: 'text/javascript' }));
  let port, worker;
  try {
    port = new Worker(url, { type: 'module' });
    worker = new PDFWorker({ port });
  } catch (error) {
    port?.terminate();
    URL.revokeObjectURL(url);
    throw error;
  }
  let loading,
    closed = false,
    cleaned = false;
  const fail = (error) => {
    if (!closed) {
      onFailure?.(error);
      loading?.destroy();
    }
  };
  class Range extends PDFDataRangeTransport {
    requestDataRange(begin, end) {
      (async () => {
        const buffer = new Uint8Array(end - begin);
        for (let at = begin; at < end; at += PDF_CHUNK_BYTES) {
          if (closed) return;
          const r = await execute({
            action: 'pdf.read',
            noteId,
            documentId: document.id,
            offset: at,
            length: Math.min(PDF_CHUNK_BYTES, end - at),
          });
          buffer.set(decode64(r.data), at - begin);
        }
        if (!closed) this.onDataRange(begin, buffer);
      })().catch(fail);
    }
    abort() {
      closed = true;
    }
  }
  class BinaryDataFactory {
    async fetch({ kind, filename }) {
      const directory = {
        cMapUrl: 'cmaps',
        standardFontDataUrl: 'standard_fonts',
        wasmUrl: 'wasm',
        iccUrl: 'iccs',
      }[kind];
      if (!directory) throw new Error('不支持的 PDF 资源');
      return asset(execute, directory + '/' + filename);
    }
  }
  loading = getDocument({
    range: new Range(document.size, null, true, document.name),
    rangeChunkSize: PDF_CHUNK_BYTES,
    worker,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
    BinaryDataFactory,
    cMapUrl: 'cmaps/',
    standardFontDataUrl: 'standard_fonts/',
    wasmUrl: 'wasm/',
    isEvalSupported: false,
    disableWorkerRendering: true,
    enableXfa: false,
  });
  loading.onPassword = (update, reason) => onPassword(update, reason);
  const close = async () => {
    if (cleaned) return;
    cleaned = true;
    closed = true;
    signal?.removeEventListener('abort', close);
    await loading.destroy().catch(() => {});
    worker.destroy();
    port.terminate();
    URL.revokeObjectURL(url);
  };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) {
    await close();
    throw signal.reason;
  }
  try {
    const pdf = await loading.promise,
      labels = await pdf.getPageLabels(),
      cache = new Map();
    await execute({
      action: 'pdf.info',
      noteId,
      documentId: document.id,
      pageCount: pdf.numPages,
      title: '',
    });
    return {
      pdf,
      labels,
      close,
      async page(number) {
        if (!cache.has(number))
          cache.set(
            number,
            (async () => {
              const page = await pdf.getPage(number),
                content = await page.getTextContent();
              const items = content.items
                .filter((item) => typeof item.str === 'string')
                .map((item) => {
                  const [a, b, c, d, x, y] = item.transform,
                    angle = Math.atan2(b, a),
                    height = Math.hypot(c, d) || item.height || 12,
                    p = [x + Math.cos(angle) * item.width, y + Math.sin(angle) * item.width],
                    q = [x - Math.sin(angle) * height, y + Math.cos(angle) * height],
                    r = [p[0] + q[0] - x, p[1] + q[1] - y];
                  return {
                    text: item.str,
                    eol: item.hasEOL,
                    rect: [
                      Math.min(x, p[0], q[0], r[0]),
                      Math.min(y, p[1], q[1], r[1]),
                      Math.max(x, p[0], q[0], r[0]),
                      Math.max(y, p[1], q[1], r[1]),
                    ],
                  };
                });
              const text = items.map((item) => item.text + (item.eol ? '\n' : ' ')).join('');
              const indexRequest = {
                action: 'pdf.indexPage',
                noteId,
                documentId: document.id,
                page: number,
                label: labels?.[number - 1] || String(number),
                view: page.view,
                text,
                items: items.filter(
                  (item) => item.text && item.rect[2] > item.rect[0] && item.rect[3] > item.rect[1],
                ),
              };
              let indexing;
              const index = () =>
                (indexing ||= execute(indexRequest).catch((error) => {
                  indexing = null;
                  throw error;
                }));
              // The visible reader starts indexing in the background; preloaded
              // pages stay in memory until actually viewed or explicitly searched.
              return { page, content, items, text, index };
            })().catch((error) => {
              cache.delete(number);
              throw error;
            }),
          );
        return cache.get(number);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export function viewportRect(viewport, rect) {
  const p = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ].map((point) => viewport.convertToViewportPoint(...point));
  return {
    x: Math.min(...p.map((point) => point[0])),
    y: Math.min(...p.map((point) => point[1])),
    width: Math.max(...p.map((point) => point[0])) - Math.min(...p.map((point) => point[0])),
    height: Math.max(...p.map((point) => point[1])) - Math.min(...p.map((point) => point[1])),
  };
}
export function pdfRect(viewport, x, y, width, height) {
  const a = viewport.convertToPdfPoint(x, y),
    b = viewport.convertToPdfPoint(x + width, y + height);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
export async function renderPdfRegion(engine, number, rects, ink = []) {
  if (!rects.length && ink.length)
    rects = [
      [
        Math.min(...ink.map((p) => p[0])) - 12,
        Math.min(...ink.map((p) => p[1])) - 12,
        Math.max(...ink.map((p) => p[0])) + 12,
        Math.max(...ink.map((p) => p[1])) + 12,
      ],
    ];
  const { page } = await engine.page(number),
    base = page.getViewport({ scale: 1 }),
    boxes = rects.length
      ? rects.map((rect) => viewportRect(base, rect))
      : [{ x: 0, y: 0, width: base.width, height: base.height }],
    left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 8),
    top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 8),
    right = Math.min(base.width, Math.max(...boxes.map((b) => b.x + b.width)) + 8),
    bottom = Math.min(base.height, Math.max(...boxes.map((b) => b.y + b.height)) + 8),
    scale = Math.min(2, 1800 / Math.max(1, right - left), 1800 / Math.max(1, bottom - top));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((right - left) * scale));
  canvas.height = Math.max(1, Math.ceil((bottom - top) * scale));
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -left * scale, -top * scale],
    background: '#ffffff',
  }).promise;
  if (ink.length) {
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ink.forEach((point, i) => {
      const [x, y] = base.convertToViewportPoint(...point);
      ctx[i ? 'lineTo' : 'moveTo']((x - left) * scale, (y - top) * scale);
    });
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#d6503c';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  return {
    canvas,
    image: { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] },
  };
}
