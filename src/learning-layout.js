export const LEARNING_TYPES = {
  question: {
    name: '提问卡',
    hint: '问题与参考答案',
    fields: [
      ['question', '问题', true, 3],
      ['answer', '参考答案（可留空）', false, 6],
    ],
  },
  concept: {
    name: '知识点',
    hint: '按 1、2、3 组织多个知识点',
    fields: [['title', '卡片标题（可留空）', false, 1]],
  },
  comparison: {
    name: '对比卡',
    hint: '两个概念并列对照',
    fields: [
      ['title', '对比主题', false, 1],
      ['leftTitle', '左侧名称', true, 1],
      ['rightTitle', '右侧名称', true, 1],
      ['leftBody', '左侧说明', false, 5],
      ['rightBody', '右侧说明', false, 5],
    ],
  },
  steps: {
    name: '步骤卡',
    hint: '过程、方法或推导',
    fields: [
      ['title', '步骤标题', false, 1],
      ['steps', '步骤内容（每行一步，最多 20 步）', true, 8],
    ],
  },
};
export function normalizeConcept(values = {}) {
  const source = Array.isArray(values.items)
    ? values.items
    : [{ id: 'legacy', title: values.title || '', body: values.body || '' }];
  const used = new Set();
  return {
    title: Array.isArray(values.items) ? String(values.title || '') : '',
    items: source.map((item, index) => {
      let id = String(item.id || 'point-' + index);
      while (used.has(id)) id += '-copy';
      used.add(id);
      return { id, title: String(item.title || ''), body: String(item.body || '') };
    }),
  };
}
export function wrapLearningText(text, width, fontSize, measure) {
  const chars = (s) =>
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)].map((v) => v.segment)
      : Array.from(s);
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .flatMap((paragraph) => {
      const lines = [];
      let line = '';
      for (const ch of chars(paragraph)) {
        if (line && measure(line + ch, fontSize) > width) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
      lines.push(line);
      return lines;
    })
    .join('\n');
}
export function layoutLearningCard(
  kind,
  values,
  area,
  scale = 1,
  measure = (text, font) => Array.from(text).length * font * 0.6,
) {
  const pad = 18 * scale,
    gap = 14 * scale,
    width = Math.max(kind === 'comparison' ? 340 : 270, area.width / scale) * scale,
    bodyWidth = width - 2 * pad,
    items = [];
  const text = (role, field, value, x, y, w, font = 17, color = '#24382c') => {
    const size = font * scale,
      wrapped = wrapLearningText(value, w, size, measure),
      height = Math.max(1, wrapped.split('\n').length) * size * 1.35;
    items.push({
      role,
      field,
      type: 'text',
      x,
      y,
      width: w,
      height,
      text: wrapped,
      fontSize: size,
      fontFamily: 2,
      lineHeight: 1.35,
      textAlign: 'left',
      verticalAlign: 'top',
      strokeColor: color,
    });
    return height;
  };
  const box = (role, x, y, w, h, color = '#ffffff') =>
    items.push({
      role,
      type: 'rectangle',
      x,
      y,
      width: w,
      height: h,
      backgroundColor: color,
      strokeColor: '#c8d4cb',
      fillStyle: 'solid',
      roughness: 0,
      strokeWidth: 1,
      roundness: { type: 3 },
    });
  let y = pad;
  y += text('kind', null, LEARNING_TYPES[kind]?.name || '图片备注', pad, y, bodyWidth, 12, '#718276') + gap;
  if (kind === 'question') {
    y += text('question', 'question', values.question, pad, y, bodyWidth, 21) + gap;
    y += text('answer-label', null, '参考答案', pad, y, bodyWidth, 12, '#718276') + 6 * scale;
    y += values.answer ? text('answer', 'answer', values.answer, pad, y, bodyWidth) : 68 * scale;
  } else if (kind === 'concept') {
    const points = normalizeConcept(values);
    if (points.items.length > 20) throw new Error('每张卡片最多 20 个知识点');
    if (points.title) y += text('title', 'title', points.title, pad, y, bodyWidth, 21) + gap;
    points.items.forEach((item, index) => {
      if (index) y += gap;
      text('point-' + item.id + '-number', null, String(index + 1) + '.', pad, y, 30 * scale, 18, '#52745c');
      const x = pad + 34 * scale,
        w = bodyWidth - 34 * scale;
      if (item.title)
        y += text('point-' + item.id + '-title', 'point:' + item.id + ':title', item.title, x, y, w, 19);
      if (item.body) {
        if (item.title) y += 6 * scale;
        y += text('point-' + item.id + '-body', 'point:' + item.id + ':body', item.body, x, y, w, 16);
      }
    });
  } else if (kind === 'comparison') {
    if (values.title) y += text('title', 'title', values.title, pad, y, bodyWidth, 21) + gap;
    const col = (bodyWidth - gap) / 2,
      left = pad,
      right = pad + col + gap,
      top = y,
      inner = 12 * scale,
      heights = [];
    for (const [side, x] of [
      ['left', left],
      ['right', right],
    ]) {
      let cy = top + inner;
      cy +=
        text(side + '-title', side + 'Title', values[side + 'Title'], x + inner, cy, col - 2 * inner, 19) +
        gap;
      cy += values[side + 'Body']
        ? text(side + '-body', side + 'Body', values[side + 'Body'], x + inner, cy, col - 2 * inner)
        : 66 * scale;
      heights.push(cy - top + inner);
    }
    const h = Math.max(...heights);
    items.unshift(
      {
        role: 'left-panel',
        type: 'rectangle',
        x: left,
        y: top,
        width: col,
        height: h,
        backgroundColor: '#f0f5fc',
        strokeColor: 'transparent',
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: 3 },
      },
      {
        role: 'right-panel',
        type: 'rectangle',
        x: right,
        y: top,
        width: col,
        height: h,
        backgroundColor: '#eff6ef',
        strokeColor: 'transparent',
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: 3 },
      },
    );
    y += h;
  } else if (kind === 'steps') {
    if (values.title) y += text('title', 'title', values.title, pad, y, bodyWidth, 21) + gap;
    const steps = String(values.steps || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
    if (steps.length > 20) throw new Error('每张步骤卡最多 20 步，请拆成多张卡片');
    const horizontal =
      steps.length > 1 && steps.length <= 4 && width >= 580 * scale && width > Math.max(1, area.height) * 1.6;
    if (horizontal) {
      const arrowGap = 28 * scale,
        w = (bodyWidth - arrowGap * (steps.length - 1)) / steps.length,
        top = y,
        hs = [];
      steps.forEach((value, i) => {
        const x = pad + i * (w + arrowGap);
        hs.push(
          text('step-' + i, 'step:' + i, value, x + 12 * scale, top + 38 * scale, w - 24 * scale) +
            52 * scale,
        );
        text(
          'number-' + i,
          null,
          String(i + 1),
          x + 12 * scale,
          top + 10 * scale,
          w - 24 * scale,
          13,
          '#52745c',
        );
      });
      const h = Math.max(...hs);
      for (let i = 0; i < steps.length; i++) {
        const x = pad + i * (w + arrowGap);
        items.unshift({
          role: 'step-panel-' + i,
          type: 'rectangle',
          x,
          y: top,
          width: w,
          height: h,
          backgroundColor: '#fff',
          strokeColor: '#c8d4cb',
          fillStyle: 'solid',
          roughness: 0,
          roundness: { type: 3 },
        });
        if (i)
          items.push({
            role: 'step-arrow-' + i,
            type: 'arrow',
            x: x - arrowGap + 4 * scale,
            y: top + h / 2,
            width: arrowGap - 8 * scale,
            height: 0,
            points: [
              [0, 0],
              [arrowGap - 8 * scale, 0],
            ],
            endArrowhead: 'arrow',
            strokeColor: '#718276',
            roughness: 0,
            strokeWidth: 1.5,
          });
      }
      y += h;
    } else
      steps.forEach((value, i) => {
        const top = y,
          inner = 12 * scale,
          h = Math.max(
            50 * scale,
            text('step-' + i, 'step:' + i, value, pad + 42 * scale, top + inner, bodyWidth - 54 * scale) +
              2 * inner,
          );
        text('number-' + i, null, String(i + 1), pad + inner, top + inner, 24 * scale, 14, '#52745c');
        items.unshift({
          role: 'step-panel-' + i,
          type: 'rectangle',
          x: pad,
          y: top,
          width: bodyWidth,
          height: h,
          backgroundColor: '#fff',
          strokeColor: '#c8d4cb',
          fillStyle: 'solid',
          roughness: 0,
          roundness: { type: 3 },
        });
        y += h;
        if (i < steps.length - 1) {
          items.push({
            role: 'step-arrow-' + i,
            type: 'arrow',
            x: pad + 24 * scale,
            y: y + 3 * scale,
            width: 0,
            height: 18 * scale,
            points: [
              [0, 0],
              [0, 18 * scale],
            ],
            endArrowhead: 'arrow',
            strokeColor: '#718276',
            roughness: 0,
            strokeWidth: 1.5,
          });
          y += 26 * scale;
        }
      });
  } else if (kind === 'image-note') y += text('note', 'note', values.note, pad, y, bodyWidth, 16);
  else throw new Error('学习控件类型不支持');
  const height = y + pad;
  items.unshift({
    role: 'background',
    type: 'rectangle',
    x: 0,
    y: 0,
    width,
    height,
    backgroundColor: kind === 'image-note' ? '#fffbe9' : '#f7faf7',
    strokeColor: '#bbcbbf',
    fillStyle: 'solid',
    roughness: 0,
    strokeWidth: 1,
    roundness: { type: 3 },
  });
  return { width, height, items };
}
export function findLearningSpace(rect, obstacles, gap = 20) {
  let y = rect.y;
  for (let i = 0; i < obstacles.length + 1; i++) {
    const hits = obstacles.filter(
      (o) =>
        rect.x < o.x + o.width && rect.x + rect.width > o.x && y < o.y + o.height && y + rect.height > o.y,
    );
    if (!hits.length) return { ...rect, y };
    y = Math.max(...hits.map((o) => o.y + o.height)) + gap;
  }
  return { ...rect, y };
}
