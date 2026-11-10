import { wrapLearningText } from './learning-layout.js';

export const INFOGRAPHIC_PALETTES = {
  navy: {
    background: '#071021',
    text: '#f3eedb',
    muted: '#9caabd',
    accent: '#d9b75f',
    secondary: '#90aec6',
    panel: '#111e32',
    border: '#2c3d55',
  },
  paper: {
    background: '#fbfaf5',
    text: '#24382c',
    muted: '#758273',
    accent: '#8b692c',
    secondary: '#3e777a',
    panel: '#edf1e9',
    border: '#cbd5c5',
  },
};
function textShape(value, box, measure) {
  let size = box.fontSize,
    text,
    height;
  do {
    text = wrapLearningText(value, box.width, size, measure);
    height = text.split('\n').length * size * 1.35;
    if (height <= box.height + 2 || size <= 20) break;
    size -= 1;
  } while (true);
  if (height > box.height + 2)
    throw new Error('信息图文字过密，无法清晰排版。可重新生成，并要求精简文字、增加留白。');
  const width = Math.min(
    box.width,
    Math.ceil(Math.max(...text.split('\n').map((line) => measure(line, size)))) + 1,
  );
  return {
    type: 'text',
    text,
    originalText: text,
    x: box.x + (box.align === 'center' ? (box.width - width) / 2 : 0),
    y: box.y,
    width,
    height,
    fontFamily: 2,
    fontSize: size,
    lineHeight: 1.35,
    textAlign: box.align || 'left',
    verticalAlign: 'top',
    autoResize: true,
  };
}
export function infographicShapes(entry, measure) {
  const f = entry.figure,
    p = INFOGRAPHIC_PALETTES[f.theme] || INFOGRAPHIC_PALETTES.navy;
  const prefix = 'info-' + entry.id + '-',
    shapes = [],
    nodes = new Map(f.nodes.map((n) => [n.id, n]));
  const add = (id, shape, evidence = {}) =>
    shapes.push({
      id: prefix + id,
      strokeWidth: 1.5,
      roughness: 0,
      fillStyle: 'solid',
      ...shape,
      customData: {
        studyboard: { summaryId: entry.summaryId },
        infographic: {
          figureId: entry.id,
          sourceIds: evidence.sourceIds?.length ? evidence.sourceIds : f.sourceIds,
          origin: evidence.origin || f.origin,
          label: evidence.text || evidence.label || f.title,
        },
      },
    });
  add('background', {
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 1600,
    height: f.height,
    backgroundColor: p.background,
    strokeColor: 'transparent',
    locked: true,
  });
  add('kicker', {
    ...textShape(
      f.origin === 'inference' ? 'AI 信息图  /  由材料进一步推断' : 'AI 信息图  /  材料观点',
      { x: 64, y: 36, width: 1472, height: 32, fontSize: 20 },
      measure,
    ),
    strokeColor: p.accent,
  });
  add('title', {
    ...textShape(f.title, { x: 64, y: 84, width: 1472, height: 92, fontSize: 48 }, measure),
    strokeColor: p.text,
  });
  add('header-line', {
    type: 'line',
    x: 64,
    y: 194,
    points: [
      [0, 0],
      [1472, 0],
    ],
    strokeColor: p.border,
  });
  // Background regions are independent native shapes; text remains directly editable.
  for (const n of f.nodes.filter((n) => n.kind === 'panel'))
    add(
      n.id,
      {
        type: 'rectangle',
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        backgroundColor: n.fill === 'accent' ? p.accent : n.fill === 'none' ? 'transparent' : p.panel,
        strokeColor: p.border,
        roundness: { type: 3 },
      },
      n,
    );
  const endpoint = (a, b) => {
    const x = a.x + a.width / 2,
      y = a.y + a.height / 2,
      dx = b.x + b.width / 2 - x,
      dy = b.y + b.height / 2 - y;
    const t = Math.min(
      (a.width / 2 + 10) / Math.max(0.01, Math.abs(dx)),
      (a.height / 2 + 10) / Math.max(0.01, Math.abs(dy)),
    );
    return [x + dx * t, y + dy * t];
  };
  for (const [i, e] of f.edges.entries()) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to);
    if (!a || !b) continue;
    const [x, y] = endpoint(a, b),
      [ex, ey] = endpoint(b, a);
    add(
      'edge-' + i,
      {
        type: 'arrow',
        x,
        y,
        points: [
          [0, 0],
          [ex - x, ey - y],
        ],
        startArrowhead: e.arrow === 'both' ? 'arrow' : null,
        endArrowhead: e.arrow === 'none' ? null : 'arrow',
        strokeColor: e.origin === 'inference' ? p.secondary : p.accent,
        strokeStyle: e.origin === 'inference' ? 'dashed' : 'solid',
        strokeWidth: 2,
        ...(e.label
          ? {
              label: {
                text: (e.origin === 'inference' ? '推断 · ' : '') + e.label,
                fontFamily: 2,
                fontSize: 20,
                strokeColor: p.text,
              },
            }
          : {}),
      },
      e,
    );
  }
  for (const n of f.nodes.filter((n) => n.kind === 'text'))
    add(
      n.id,
      {
        ...textShape((n.origin === 'inference' ? '推断 · ' : '') + n.text, n, measure),
        strokeColor: p[n.tone] || p.text,
      },
      n,
    );
  // Images are inserted by the browser renderer after resolving source pixel dimensions.
  add('footer-line', {
    type: 'line',
    x: 64,
    y: f.height - 86,
    points: [
      [0, 0],
      [1472, 0],
    ],
    strokeColor: p.border,
  });
  add('footer', {
    ...textShape(
      '来源：本笔记材料与本次总结  ·  点击「来源」对照生成依据',
      { x: 64, y: f.height - 58, width: 1472, height: 34, fontSize: 20 },
      measure,
    ),
    strokeColor: p.muted,
  });
  return { shapes, palette: p, prefix };
}
