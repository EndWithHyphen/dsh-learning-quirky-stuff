import {
  convertToExcalidrawElements,
  exportToSvg,
  exportToCanvas,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import { infographicShapes } from './infographic-layout.js';
import { download, filename } from './export.js';

export async function visibleSource(asset) {
  if (!asset?.dataURL) throw new Error('信息图引用的原图未保存完整');
  const image = new Image();
  image.src = asset.dataURL;
  await image.decode();
  const crop = asset.crop || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  if (!asset.crop && !asset.angle && !(asset.scale || [1, 1]).some((v) => v !== 1))
    return { dataURL: asset.dataURL, width: image.naturalWidth, height: image.naturalHeight };
  const angle = asset.angle || 0,
    w = crop.width,
    h = crop.height,
    cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle)),
    canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * cos + h * sin);
  canvas.height = Math.ceil(w * sin + h * cos);
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle);
  context.scale(...(asset.scale || [1, 1]));
  context.drawImage(image, crop.x, crop.y, w, h, -w / 2, -h / 2, w, h);
  return { dataURL: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
export async function buildInfographicScene(entry) {
  const context = document.createElement('canvas').getContext('2d');
  const measure = (text, size) => {
    context.font = `${size}px Helvetica, Arial, sans-serif`;
    return context.measureText(text).width;
  };
  const { shapes, palette, prefix } = infographicShapes(entry, measure),
    files = {},
    resolved = new Map();
  for (const n of entry.figure.nodes.filter((n) => n.kind === 'image')) {
    if (!resolved.has(n.imageSourceId))
      resolved.set(n.imageSourceId, await visibleSource(entry.assets[n.imageSourceId]));
    const source = resolved.get(n.imageSourceId),
      fileId = prefix + n.imageSourceId;
    files[fileId] = {
      id: fileId,
      dataURL: source.dataURL,
      mimeType: source.dataURL.slice(5, source.dataURL.indexOf(';')),
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
    const crop = {
      x: n.crop.x * source.width,
      y: n.crop.y * source.height,
      width: n.crop.width * source.width,
      height: n.crop.height * source.height,
      naturalWidth: source.width,
      naturalHeight: source.height,
    };
    const scale = Math.min(n.width / crop.width, n.height / crop.height),
      width = crop.width * scale,
      height = crop.height * scale;
    shapes.push({
      id: prefix + n.id,
      type: 'image',
      x: n.x + (n.width - width) / 2,
      y: n.y + (n.height - height) / 2,
      width,
      height,
      crop,
      fileId,
      status: 'saved',
      scale: [1, 1],
      customData: {
        studyboard: { summaryId: entry.summaryId },
        infographic: {
          figureId: entry.id,
          label: entry.assets[n.imageSourceId]?.title || n.imageSourceId,
          sourceIds: [...new Set([n.imageSourceId, ...n.sourceIds])],
          origin: n.origin,
        },
      },
    });
  }
  const elements = convertToExcalidrawElements(shapes, { regenerateIds: false });
  const byId = new Map(elements.map((e) => [e.id, e]));
  // The transform helper treats centered text coordinates as an anchor. Our layout
  // has already measured its top-left box; preserve that position after conversion.
  const positions = new Map(shapes.filter((s) => s.type === 'text').map((s) => [s.id, s]));
  for (const e of elements)
    if (positions.has(e.id)) {
      const intended = positions.get(e.id);
      e.x = intended.x;
      e.y = intended.y;
    }
  for (const e of elements) if (e.containerId) e.customData = byId.get(e.containerId)?.customData;
  return {
    elements,
    files,
    appState: {
      viewBackgroundColor: palette.background,
      exportBackground: true,
      exportWithDarkMode: false,
      currentItemFontFamily: 2,
      currentItemStrokeColor: palette.text,
      currentItemRoughness: 0,
      gridSize: null,
    },
  };
}
export function infographicSvg(scene) {
  return exportToSvg({
    elements: scene.elements.filter((e) => !e.isDeleted),
    files: scene.files,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    exportPadding: 0,
  });
}
export function placeInfographic(scene, origin) {
  const live = scene.elements.filter((e) => !e.isDeleted),
    ids = new Map(live.map((e) => [e.id, crypto.randomUUID()])),
    groups = new Map();
  const summaryId = live.find((e) => e.customData?.studyboard?.summaryId)?.customData.studyboard.summaryId;
  const x = Math.min(0, ...live.map((e) => e.x)),
    y = Math.min(0, ...live.map((e) => e.y));
  const elements = live.map((element) => {
    const e = structuredClone(element);
    if (summaryId) e.customData = { ...e.customData, studyboard: { ...e.customData?.studyboard, summaryId } };
    e.id = ids.get(e.id);
    e.x += origin.x - x;
    e.y += origin.y - y;
    e.groupIds = (e.groupIds || []).map((id) => {
      if (!groups.has(id)) groups.set(id, crypto.randomUUID());
      return groups.get(id);
    });
    if (e.containerId) e.containerId = ids.get(e.containerId) || null;
    if (e.frameId) e.frameId = ids.get(e.frameId) || null;
    if (e.boundElements)
      e.boundElements = e.boundElements
        .filter((b) => ids.has(b.id))
        .map((b) => ({ ...b, id: ids.get(b.id) }));
    for (const key of ['startBinding', 'endBinding'])
      if (e[key])
        e[key] = ids.has(e[key].elementId) ? { ...e[key], elementId: ids.get(e[key].elementId) } : null;
    return e;
  });
  return {
    elements,
    files: Object.values(scene.files),
    height: Math.max(0, ...live.map((e) => e.y + e.height)) - y,
  };
}
export async function exportInfographic(scene, title, format) {
  if (format === 'excalidraw')
    return download(
      new Blob([serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')], {
        type: 'application/json',
      }),
      filename(title, format),
    );
  if (format === 'svg')
    return download(
      new Blob([(await infographicSvg(scene)).outerHTML], { type: 'image/svg+xml' }),
      filename(title, format),
    );
  const canvas = await exportToCanvas({
    elements: scene.elements.filter((e) => !e.isDeleted),
    files: scene.files,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    exportPadding: 0,
    getDimensions: (width, height) => {
      const scale = Math.min(2, 6000 / Math.max(width, height));
      return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
    },
  });
  if (format === 'png') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    if (!blob) throw new Error('图片导出失败');
    return download(blob, filename(title, format));
  }
  const { jsPDF } = await import('jspdf'),
    pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [canvas.width / 2, canvas.height / 2],
      compress: true,
    });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
  download(pdf.output('blob'), filename(title, 'pdf'));
}
