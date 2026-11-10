import React, { useEffect, useRef, useState } from 'react';
import { newElementWith, CaptureUpdateAction, FONT_FAMILY } from '@excalidraw/excalidraw';
import { longCanvasText, wrapCanvasText } from './canvas-text-layout.js';

// Track text content rather than versions: moving, saving and undoing a layout do not reflow it.
export default function CanvasTextWrap({ apiRef }) {
  const seen = useRef(new Map()),
    [available, setAvailable] = useState(false);
  const apply = useRef();
  useEffect(() => {
    let stopped = false,
      frame,
      off,
      applying = false,
      initial = true;
    const context = document.createElement('canvas').getContext('2d');
    const attach = () => {
      if (stopped) return;
      const api = apiRef.current;
      if (!api) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const layout = (manual = false) => {
        if (applying) return;
        const state = api.getAppState(),
          elements = api.getSceneElementsIncludingDeleted();
        if (!state.width || state.editingTextElement || state.resizingElement || state.draggingElement)
          return;
        const selected = elements.filter((e) => state.selectedElementIds[e.id] && !e.isDeleted),
          candidates = (selected.length ? selected : elements).filter((e) => longCanvasText(e, state.width));
        setAvailable(candidates.length > 0);
        const sparse = elements.filter((e) => !e.isDeleted).length <= 12;
        const wanted = new Set(
          manual
            ? candidates.map((e) => e.id)
            : elements
                .filter((e) => {
                  const text = e.originalText || e.text,
                    old = seen.current.get(e.id);
                  return (
                    longCanvasText(e, state.width) &&
                    e.autoResize !== false &&
                    (initial ? sparse : old !== text)
                  );
                })
                .map((e) => e.id),
        );
        for (const e of elements) seen.current.set(e.id, e.originalText || e.text);
        initial = false;
        if (!wanted.size) return;
        let next = [...elements],
          count = 0;
        for (const e of elements)
          if (wanted.has(e.id)) {
            const family =
              Object.entries(FONT_FAMILY).find(([, id]) => id === e.fontFamily)?.[0] || 'Helvetica';
            const patch = wrapCanvasText(e, next, state.width, (value, size) => {
              context.font = `${size}px "${family}", Arial, sans-serif`;
              return context.measureText(value).width;
            });
            if (patch) {
              next = next.map((item) => (item.id === e.id ? newElementWith(e, patch) : item));
              count++;
            }
          }
        if (count) {
          applying = true;
          api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          applying = false;
          if (manual)
            api.scrollToContent(
              next.filter((e) => wanted.has(e.id)),
              { fitToViewport: true, maxZoom: 1 },
            );
          api.setToast({ message: `已将 ${count} 段长文字换行，可撤销或拖动边框调整宽度` });
        }
      };
      apply.current = () => layout(true);
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => layout());
      };
      off = api.onChange(schedule);
      schedule();
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      off?.();
    };
  }, [apiRef]);
  return (
    available && (
      <button
        type="button"
        className="study-shortcut-button"
        onClick={() => apply.current?.()}
        title="为选中的长文字换行；未选择时整理画布中的长文字"
      >
        整理长文字
      </button>
    )
  );
}
