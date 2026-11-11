import React, { useEffect, useState } from 'react';
import { convertToExcalidrawElements, CaptureUpdateAction, getCommonBounds } from '@excalidraw/excalidraw';
import { findLearningSpace, wrapLearningText } from '../learning-layout.js';
import { elementPdfReference } from '../../shared/pdf.js';
export function appendPdfClip(api, { reference, text, image, width, height }) {
  const state = api.getAppState(),
    all = api.getSceneElementsIncludingDeleted(),
    group = crypto.randomUUID(),
    w = Math.min(620, Math.max(300, state.width - (state.width >= 740 ? 250 : 70))),
    font = 18,
    ctx = document.createElement('canvas').getContext('2d'),
    label = wrapLearningText(reference.title + ' · 第 ' + reference.page + ' 页', w, 12, (s, n) => {
      ctx.font = n + 'px Arial';
      return ctx.measureText(s).width;
    }),
    labelHeight = label.split('\n').length * 15 + 14,
    wrapped = wrapLearningText(text || '', w - 32, font, (value, size) => {
      ctx.font = size + 'px Helvetica, Arial, sans-serif';
      return ctx.measureText(value).width;
    }),
    bodyHeight = image
      ? ((height || 1) * w) / (width || 1)
      : Math.max(1, wrapped.split('\n').length) * font * 1.35,
    obstacles = all
      .filter((e) => !e.isDeleted && e.type !== 'frame')
      .map((e) => {
        const [x, y, r, b] = getCommonBounds([e]);
        return { x, y, width: r - x, height: b - y };
      }),
    area = findLearningSpace(
      { x: -state.scrollX + 40, y: -state.scrollY + 40, width: w, height: bodyHeight + labelHeight + 28 },
      obstacles,
      28,
    ),
    meta = (role) => ({ studyboard: { pdfSource: reference, role } }),
    shapes = [];
  shapes.push({
    type: 'text',
    x: area.x,
    y: area.y,
    width: w,
    text: label,
    lineHeight: 1.25,
    fontSize: 12,
    fontFamily: 2,
    strokeColor: '#6b7f73',
    groupIds: [group],
    customData: meta('pdf-source'),
  });
  const top = area.y + labelHeight;
  if (image) {
    const fileId = crypto.randomUUID();
    api.addFiles([
      {
        id: fileId,
        mimeType: image.mimeType,
        dataURL: 'data:' + image.mimeType + ';base64,' + image.data,
        created: Date.now(),
      },
    ]);
    shapes.push({
      type: 'image',
      fileId,
      status: 'saved',
      x: area.x,
      y: top,
      width: w,
      height: bodyHeight,
      groupIds: [group],
      customData: meta('pdf-figure'),
    });
  } else {
    shapes.push({
      type: 'rectangle',
      x: area.x,
      y: top,
      width: w,
      height: bodyHeight + 28,
      backgroundColor: '#f6f8f5',
      strokeColor: '#d6dfd7',
      fillStyle: 'solid',
      roughness: 0,
      roundness: { type: 3 },
      groupIds: [group],
      customData: meta('pdf-excerpt-box'),
    });
    shapes.push({
      type: 'text',
      x: area.x + 16,
      y: top + 14,
      width: w - 32,
      text: wrapped,
      originalText: text,
      fontSize: font,
      fontFamily: 2,
      lineHeight: 1.35,
      textAlign: 'left',
      autoResize: false,
      strokeColor: '#24382c',
      groupIds: [group],
      customData: meta('pdf-excerpt'),
    });
  }
  const elements = convertToExcalidrawElements(shapes);
  api.updateScene({
    elements: [...all, ...elements],
    appState: { selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.setActiveTool({ type: 'selection' });
  return elements;
}
export function focusPdfClip(api, elements, root) {
  const state = api.getAppState(),
    host = root.getBoundingClientRect(),
    panel = root.querySelector('.selected-shape-actions .Island')?.getBoundingClientRect(),
    left =
      panel && panel.width && panel.left < host.left + 80
        ? panel.right - host.left + 20
        : state.width >= 730
          ? 236
          : 24,
    top = 72,
    w = Math.max(150, state.width - left - 24),
    h = Math.max(120, state.height - top - 80),
    [x, y, r, b] = getCommonBounds(elements),
    zoom = Math.max(0.1, Math.min(1, w / Math.max(1, r - x), h / Math.max(1, b - y)) * 0.92);
  api.updateScene({
    appState: {
      zoom: { value: zoom },
      scrollX: (left + w / 2) / zoom - (x + r) / 2,
      scrollY: (top + h / 2) / zoom - (y + b) / 2,
    },
  });
}
export function PdfClipSource({ apiRef, onOpen }) {
  const [sources, setSources] = useState([]);
  useEffect(() => {
    let frame,
      off,
      stopped = false;
    const attach = () => {
      if (stopped) return;
      const api = apiRef.current;
      if (!api) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const picked = api.getAppState().selectedElementIds,
          refs = new Map();
        for (const e of api.getSceneElements())
          if (picked[e.id] && e.customData?.studyboard?.pdfSource) {
            const ref = elementPdfReference(e);
            refs.set(ref.documentId + ':' + ref.page, ref);
          }
        const next = [...refs.values()];
        setSources((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      };
      update();
      off = api.onChange(update);
    };
    frame = requestAnimationFrame(attach);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      off?.();
    };
  }, [apiRef]);
  return sources.map((ref) => (
    <button
      type="button"
      className="study-shortcut-button sb-pdf-source-button"
      key={ref.documentId + ref.page}
      title={ref.title}
      onClick={() => onOpen(ref)}
    >
      回到 PDF · 第 {ref.page} 页 ↗{ref.edited ? '（摘录已编辑）' : ''}
    </button>
  ));
}
