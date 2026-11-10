import { exportToCanvas, restoreElements } from '@excalidraw/excalidraw';
import { inkElements, inkSignature } from '../../shared/ink.js';

export async function prepareInk(scene) {
  const strokes = restoreElements(inkElements(scene), null),
    clusters = [];
  for (const element of strokes) {
    const bounds = {
      left: element.x,
      top: element.y,
      right: element.x + element.width,
      bottom: element.y + element.height,
    };
    const group = clusters.find(
      (group) =>
        bounds.left <= group.right + 130 &&
        bounds.right >= group.left - 130 &&
        bounds.top <= group.bottom + 130 &&
        bounds.bottom >= group.top - 130,
    );
    if (group) {
      group.elements.push(element);
      group.left = Math.min(group.left, bounds.left);
      group.top = Math.min(group.top, bounds.top);
      group.right = Math.max(group.right, bounds.right);
      group.bottom = Math.max(group.bottom, bounds.bottom);
    } else clusters.push({ ...bounds, elements: [element] });
  }
  if (clusters.length > 30) throw new Error('这篇手写分区较多，请分批整理到几篇笔记后识别');
  const chunks = [];
  for (const group of clusters) {
    const canvas = await exportToCanvas({
      elements: group.elements,
      files: {},
      appState: { viewBackgroundColor: '#ffffff', exportBackground: true, exportWithDarkMode: false },
      exportPadding: 24,
      getDimensions: (width, height) => {
        const scale = Math.min(3, 2200 / width, 2200 / height);
        return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
      },
    });
    chunks.push({
      elementIds: group.elements.map((element) => element.id),
      dataURL: canvas.toDataURL('image/png'),
    });
  }
  return { signature: inkSignature(scene), chunks };
}
