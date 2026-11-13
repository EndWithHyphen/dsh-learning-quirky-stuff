import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { legacyStudy } from '../study-schema.js';
import { wrapLearningText } from './learning-layout.js';
import { diagramLayout } from './diagram-layout.js';
import { placeInfographic } from './infographic-render.js';
export function summaryCanvas(summary, scene, origin, infographics = []) {
  const study = legacyStudy(summary),
    shapes = [],
    files = [],
    extraElements = [],
    width = 680,
    ctx = document.createElement('canvas').getContext('2d');
  let y = origin.y,
    group = crypto.randomUUID();
  const measure = (text, size) => {
    ctx.font = size + 'px Helvetica, Arial, sans-serif';
    return ctx.measureText(text).width;
  };
  function add(shape) {
    shapes.push({ ...shape, groupIds: [group], customData: { studyboard: { summaryId: summary.id } } });
  }
  function text(value, size = 19, color = '#24382c') {
    if (!value) return;
    const wrapped = wrapLearningText(value, width, size, measure),
      height = wrapped.split('\n').length * size * 1.45;
    add({
      type: 'text',
      x: origin.x,
      y,
      text: wrapped,
      fontSize: size,
      fontFamily: 2,
      lineHeight: 1.45,
      strokeColor: color,
    });
    y += height + 16;
  }
  function diagram(d) {
    group = crypto.randomUUID();
    text(d.title, 23);
    const layout = diagramLayout(d, { availableWidth: width, fontSize: 17 }),
      scale = Math.min(1, width / layout.width),
      offsetY = y,
      offsetX = origin.x + (width - layout.width * scale) / 2;
    for (const edge of layout.edges) {
      const first = edge.points[0],
        label = edge.label;
      add({
        type: 'arrow',
        x: offsetX + first.x * scale,
        y: offsetY + first.y * scale,
        points: edge.points.map((p) => [(p.x - first.x) * scale, (p.y - first.y) * scale]),
        strokeColor: '#718276',
        roughness: 0,
        endArrowhead: 'arrow',
      });
      if (label.width) {
        add({
          type: 'rectangle',
          x: offsetX + (label.x - label.width / 2) * scale,
          y: offsetY + (label.y - label.height / 2) * scale,
          width: label.width * scale,
          height: label.height * scale,
          strokeColor: 'transparent',
          backgroundColor: scene.appState?.viewBackgroundColor || '#ffffff',
          fillStyle: 'solid',
          roughness: 0,
        });
        add({
          type: 'text',
          x: offsetX + (label.x - label.width / 2 + 6) * scale,
          y: offsetY + (label.y - (label.lines.length * label.lineHeight) / 2) * scale,
          width: (label.width - 12) * scale,
          text: label.lines.join('\n'),
          fontSize: label.fontSize * scale,
          lineHeight: label.lineHeight / label.fontSize,
          fontFamily: 2,
          textAlign: 'center',
          autoResize: false,
          strokeColor: '#526859',
        });
      }
    }
    for (const n of layout.nodes) {
      add({
        type: 'rectangle',
        x: offsetX + (n.x - n.width / 2) * scale,
        y: offsetY + (n.y - n.height / 2) * scale,
        width: n.width * scale,
        height: n.height * scale,
        roughness: 0,
        strokeColor: '#c3d0c7',
        backgroundColor: '#f3f7f3',
        fillStyle: 'solid',
        roundness: { type: 3 },
      });
      add({
        type: 'text',
        x: offsetX + (n.x - n.width / 2 + 14) * scale,
        y: offsetY + (n.y - (n.lines.length * n.lineHeight) / 2) * scale,
        width: (n.width - 28) * scale,
        text: n.lines.join('\n'),
        fontSize: n.fontSize * scale,
        fontFamily: 2,
        lineHeight: n.lineHeight / n.fontSize,
        textAlign: 'center',
        autoResize: false,
        strokeColor: '#24382c',
      });
    }
    y += layout.height * scale + 16;
    text(d.caption, 15, '#65746a');
    y += 24;
  }
  function source(f) {
    const asset = summary.assets?.[f.sourceId];
    if (!asset) return;
    group = crypto.randomUUID();
    text(f.title, 20);
    const known = Object.values(scene.files).find((file) => file.dataURL === asset.dataURL),
      fileId = known?.id || crypto.randomUUID();
    if (!known)
      files.push({
        id: fileId,
        dataURL: asset.dataURL,
        mimeType: asset.dataURL.slice(5, asset.dataURL.indexOf(';')),
        created: Date.now(),
      });
    const height = Math.min(1000, (width * asset.height) / asset.width),
      imageWidth = (height * asset.width) / asset.height;
    add({ type: 'image', x: origin.x, y, width: imageWidth, height, fileId, status: 'saved', scale: [1, 1] });
    y += height + 14;
    text(f.caption, 16, '#65746a');
    y += 24;
  }
  function infographic(item) {
    const placed = placeInfographic(item.scene, { x: origin.x, y });
    extraElements.push(...placed.elements);
    files.push(...placed.files);
    y += placed.height + 20;
    text(item.entry.figure.caption, 16, '#65746a');
    y += 24;
  }
  text(study.title, 30);
  text(study.overview, 20);
  for (const t of study.takeaways || []) text('• ' + t, 19);
  y += 18;
  study.diagrams.filter((d) => d.placement === 'overview').forEach(diagram);
  infographics.filter((f) => f.entry.figure.placement === 'overview').forEach(infographic);
  for (const [i, c] of study.concepts.entries()) {
    group = crypto.randomUUID();
    text(String(i + 1).padStart(2, '0') + '  ' + c.title, 25);
    text(c.explanation);
    if (c.example) text(c.example, 17, '#53685a');
    study.diagrams.filter((d) => d.placement !== 'overview' && d.conceptIds[0] === c.id).forEach(diagram);
    (study.sourceFigures || []).filter((f) => f.conceptIds[0] === c.id).forEach(source);
    infographics
      .filter((f) => f.entry.figure.placement !== 'overview' && f.entry.figure.conceptIds[0] === c.id)
      .forEach(infographic);
    y += 34;
  }
  study.diagrams.filter((d) => d.placement !== 'overview' && !d.conceptIds.length).forEach(diagram);
  (study.sourceFigures || []).filter((f) => !f.conceptIds.length).forEach(source);
  infographics
    .filter((f) => f.entry.figure.placement !== 'overview' && !f.entry.figure.conceptIds.length)
    .forEach(infographic);
  for (const insight of study.insights || []) {
    group = crypto.randomUUID();
    text(insight.title, 24);
    text(insight.text);
    y += 26;
  }
  if (study.questions.length) {
    group = crypto.randomUUID();
    text('自测与复习', 24);
    for (const q of study.questions) {
      text(q.prompt, 21);
      text(q.context, 17);
      for (const task of q.tasks || []) text('• ' + task, 17);
      text('参考答案：' + q.answer, 17);
      y += 18;
    }
  }
  if (study.scopeNote) {
    group = crypto.randomUUID();
    text(study.scopeNote, 14, '#65746a');
  }
  return { elements: [...convertToExcalidrawElements(shapes), ...extraElements], files };
}
