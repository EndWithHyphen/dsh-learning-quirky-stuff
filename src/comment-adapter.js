import { exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import { commentSelection, commentSourceContent } from '../shared/canvas-comments.js';
export const commentHash = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
export function canvasCommentAdapter(apiRef, rootRef) {
  return {
    ready: () => !!apiRef.current,
    observe: (fn) => apiRef.current.onChange(fn),
    prepare: (ids) => commentSelection(apiRef.current.getSceneElements(), ids).map((e) => e.id),
    state(threads) {
      const api = apiRef.current,
        s = api.getAppState(),
        elements = api.getSceneElements(),
        rect = rootRef.current.getBoundingClientRect(),
        engine = rootRef.current.querySelector('.excalidraw')?.getBoundingClientRect();
      if (!engine) return null;
      const selected = elements.filter((e) => !e.isDeleted && s.selectedElementIds[e.id]).map((e) => e.id),
        pins = [];
      for (const t of threads.filter((t) => !t.resolvedAt)) {
        const objects = elements.filter((e) => !e.isDeleted && t.elementIds.includes(e.id));
        if (!objects.length) continue;
        const [, top, right] = getCommonBounds(objects),
          x = engine.left - rect.left + (right + s.scrollX) * s.zoom.value + 5,
          y = engine.top - rect.top + (top + s.scrollY) * s.zoom.value - 9;
        if (x >= 0 && x <= rect.width - 24 && y >= engine.top - rect.top && y <= rect.height - 24)
          pins.push({ id: t.id, x, y });
      }
      return {
        selected,
        pins,
        bounds: { top: Math.max(8, engine.top - rect.top + 8), height: Math.max(160, engine.height - 16) },
      };
    },
    async capture(ids) {
      const api = apiRef.current,
        selected = commentSelection(api.getSceneElements(), ids),
        files = api.getFiles();
      if (ids.some((id) => !selected.some((e) => e.id === id))) throw new Error('所选组件已删除，请重新选择');
      let image;
      if (selected.some((e) => e.type !== 'text')) {
        const preview = await exportToCanvas({
          elements: selected,
          files,
          appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
          exportPadding: 24,
          getDimensions: (w, h) => {
            const scale = Math.min(1.5, 1800 / w, 1800 / h);
            return { width: Math.ceil(w * scale), height: Math.ceil(h * scale), scale };
          },
        });
        image = { mimeType: 'image/jpeg', data: preview.toDataURL('image/jpeg', 0.85).split(',')[1] };
        if (image.data.length > 2_000_000) throw new Error('所选图片过大，请缩小范围再提问');
      }
      return { sourceHash: await commentHash(commentSourceContent(selected, files)), image };
    },
    locate(thread) {
      const api = apiRef.current,
        elements = api.getSceneElements().filter((e) => thread.elementIds.includes(e.id));
      if (elements.length) {
        api.updateScene({
          appState: { selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])) },
        });
        api.scrollToContent(elements, { fitToViewport: true, maxZoom: 1, viewportZoomFactor: 0.6 });
      }
    },
  };
}
