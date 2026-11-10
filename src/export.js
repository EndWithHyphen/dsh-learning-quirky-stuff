import { exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import { jsPDF } from 'jspdf';
import { sourceImageCatalog } from '../summary-sources.js';

export function liveElements(elements) {
  return elements.filter((e) => !e.isDeleted);
}
export function cleanState(a) {
  return {
    viewBackgroundColor: a.viewBackgroundColor || '#ffffff',
    gridSize: a.gridSize ?? null,
    gridStep: a.gridStep ?? 5,
    currentItemFontFamily: 2,
    currentItemStrokeColor: a.currentItemStrokeColor || '#1b1b1f',
    currentItemStrokeWidth: a.currentItemStrokeWidth || 1,
    currentItemRoughness: a.currentItemRoughness ?? 1,
    scrollX: a.scrollX || 0,
    scrollY: a.scrollY || 0,
    zoom: { value: a.zoom?.value || 1 },
  };
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function filename(title, ext) {
  return `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || '学习笔记'}.${ext}`;
}
export async function renderBoard(scene, elements = liveElements(scene.elements), max = 6000) {
  if (!elements.length) throw new Error('白板还是空的，先写点内容或贴一张图吧');
  return exportToCanvas({
    elements,
    files: scene.files,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    exportPadding: 32,
    getDimensions: (w, h) => {
      const scale = Math.min(2, max / w, max / h, Math.sqrt(24_000_000 / (w * h)));
      return { width: Math.ceil(w * scale), height: Math.ceil(h * scale), scale };
    },
  });
}
export function grid(width, height, w, h) {
  const cols = Math.max(1, Math.ceil(width / w)),
    rows = Math.max(1, Math.ceil(height / h));
  return Array.from({ length: cols * rows }, (_, i) => ({
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    width: Math.min(w, width - (i % cols) * w),
    height: Math.min(h, height - Math.floor(i / cols) * h),
    row: Math.floor(i / cols),
    col: i % cols,
    cols,
    rows,
  }));
}
export async function summaryImages(scene, elements) {
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  if ((x2 - x1) * (y2 - y1) > 18_000_000) throw new Error('白板范围较大，请框选一个主题后再总结');
  const canvas = await renderBoard(scene, elements, 5000);
  const cells = grid(canvas.width, canvas.height, 1450, 1450);
  if (cells.length > 8) throw new Error('内容超过 8 个图像区域，请框选一个主题后再总结');
  const previews = cells.map((c) => {
    const crop = document.createElement('canvas');
    crop.width = c.width;
    crop.height = c.height;
    crop.getContext('2d').drawImage(canvas, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
    return { mimeType: 'image/jpeg', data: crop.toDataURL('image/jpeg', 0.88).split(',')[1] };
  });
  const catalog = sourceImageCatalog(elements),
    byId = new Map(elements.map((e) => [e.id, e]));
  if (Math.ceil(catalog.length / 2) + previews.length > 20)
    throw new Error('图片较多，请框选一个主题后再总结');
  for (let i = 0; i < catalog.length; i += 2) {
    const parts = [];
    for (const source of catalog.slice(i, i + 2))
      parts.push({ source, canvas: await renderBoard(scene, [byId.get(source.elementId)], 1400) });
    const sheet = document.createElement('canvas');
    sheet.width = Math.max(...parts.map((p) => p.canvas.width));
    sheet.height = parts.reduce((h, p) => h + p.canvas.height + 48, 0);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    let y = 0;
    for (const { source, canvas: raw } of parts) {
      ctx.fillStyle = '#172d22';
      ctx.font = '600 22px system-ui';
      ctx.fillText(source.id + ' · 原图', 16, y + 32);
      ctx.drawImage(raw, (sheet.width - raw.width) / 2, y + 48);
      y += raw.height + 48;
    }
    previews.push({ mimeType: 'image/jpeg', data: sheet.toDataURL('image/jpeg', 0.9).split(',')[1] });
  }
  return previews;
}
export async function thumbnail(scene) {
  if (!liveElements(scene.elements).length) return null;
  return (await renderBoard(scene, liveElements(scene.elements), 420)).toDataURL('image/jpeg', 0.7);
}
export async function pdfBlob(board, scene, mode = 'pages') {
  const elements = liveElements(scene.elements),
    canvas = await renderBoard(scene, elements, 10000);
  const bounds = getCommonBounds(elements),
    worldW = bounds[2] - bounds[0] + 64;
  const pixelPerUnit = canvas.width / worldW;
  const cellW = mode === 'overview' ? canvas.width : Math.max(1, Math.min(canvas.width, 1100 * pixelPerUnit));
  const cellH = mode === 'overview' ? canvas.height : Math.max(1, 740 * pixelPerUnit);
  const cells = grid(canvas.width, canvas.height, cellW, cellH);
  if (cells.length > 60) throw new Error('导出超过 60 页，请把白板拆分成几篇笔记');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < cells.length; i++) {
    if (i) pdf.addPage();
    const c = cells[i],
      page = document.createElement('canvas');
    page.width = 2200;
    page.height = 1555;
    const p = page.getContext('2d');
    p.fillStyle = '#ffffff';
    p.fillRect(0, 0, page.width, page.height);
    p.fillStyle = '#202826';
    p.font = '600 32px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    p.fillText(board.title, 80, 72, 1900);
    p.strokeStyle = '#dce3df';
    p.beginPath();
    p.moveTo(80, 100);
    p.lineTo(2120, 100);
    p.stroke();
    const scale = Math.min(
      2040 / (mode === 'overview' ? c.width : cellW),
      1320 / (mode === 'overview' ? c.height : cellH),
    );
    p.drawImage(canvas, c.x, c.y, c.width, c.height, 80, 125, c.width * scale, c.height * scale);
    p.font = '23px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    p.fillStyle = '#65706c';
    p.fillText(
      `学习画板 · ${new Date().toLocaleDateString('zh-CN')} · ${i + 1} / ${cells.length}${cells.length > 1 ? `  (${c.row + 1}, ${c.col + 1})` : ''}`,
      80,
      1510,
    );
    pdf.addImage(page.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
  }
  return pdf.output('blob');
}
