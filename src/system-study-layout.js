import { wrapLearningText as rawWrap } from './learning-layout.js';
const wrapLearningText = (...args) => rawWrap(...args).replace(/\n([。，、；：！？）】》])/g, '$1');

function crossesBox(a, b, box) {
  let lo = 0,
    hi = 1;
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
  ]) {
    const delta = b[axis] - a[axis],
      min = box[axis] - 10,
      max = box[axis] + box[size] + 10;
    if (Math.abs(delta) < 0.01) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const ends = [(min - a[axis]) / delta, (max - a[axis]) / delta].sort((x, y) => x - y);
      lo = Math.max(lo, ends[0]);
      hi = Math.min(hi, ends[1]);
      if (lo > hi) return false;
    }
  }
  return true;
}

export const STUDY_FORMAT_NAMES = {
  argument: '论证关系',
  causal: '因果机制',
  comparison: '比较分析',
  timeline: '时间线',
  process: '过程与推导',
  concept: '概念结构',
  free: '主题布局',
};
export const STUDY_ORIGIN_NAMES = {
  source: '材料观点',
  inference: '基于材料的推断',
  background: '模型补充 · 未核实',
};
const shorten = (value, n = 130) => (value.length > n ? value.slice(0, n) + '…' : value);

export function studyViews(report) {
  const views = report.value.boards.map((b) => ({ ...b, id: 'board-' + b.id }));
  const history = report.value.history;
  if (history?.applicable && history.periods.length) {
    const nodes = [],
      edges = [];
    history.periods.forEach((period, index) => {
      nodes.push({
        id: period.id,
        title: period.label + ' · 当时的解释' + (period.dateStatus === 'retrospective' ? '（回溯重建）' : ''),
        body: '问题：' + shorten(period.problem) + '\n\n解释：' + shorten(period.explanation, 200),
        column: history.format === 'comparison' ? 0 : index,
        row: history.format === 'comparison' ? index : 0,
        role: 'concept',
        origin: 'inference',
        evidence: period.evidence,
        period,
        temporal: true,
      });
      nodes.push({
        id: period.id + '-later',
        title: '边界与后来的修正',
        body: '当时未知：' + shorten(period.unknown) + '\n\n后来：' + shorten(period.laterRevision, 180),
        column: history.format === 'comparison' ? 1 : index,
        row: history.format === 'comparison' ? index : 1,
        role: 'counterpoint',
        origin: 'inference',
        evidence: period.laterEvidence,
        period,
        temporal: true,
      });
      edges.push({
        id: period.id + '-revision',
        from: period.id,
        to: period.id + '-later',
        label: '后来检验与修正',
        origin: 'inference',
        evidence: period.laterEvidence,
      });
    });
    views.push({
      id: 'history',
      title: history.title || '时间旅行研究',
      format: history.format,
      rationale: history.reason || '围绕同一问题比较历史阶段；当时的知识与后来的回看分别呈现。',
      nodes,
      edges,
    });
  }
  return views;
}

/** The model chooses semantic positions; this only resolves geometry and text wrapping. */
export function layoutStudyView(view, measure) {
  const width = 370,
    padding = 24,
    gapX = 180,
    gapY = 110;
  const columns = [...new Set(view.nodes.map((n) => n.column))].sort((a, b) => a - b);
  const rows = [...new Set(view.nodes.map((n) => n.row))].sort((a, b) => a - b);
  const sizes = view.nodes.map((node) => {
    const text = wrapLearningText(
      node.title + '\n\n' + node.body + '\n\n' + STUDY_ORIGIN_NAMES[node.origin],
      width - padding * 2,
      18,
      measure,
    );
    return { ...node, text, width, height: Math.max(170, text.split('\n').length * 18 * 1.4 + padding * 2) };
  });
  const diagramWidth = Math.max(840, columns.length * (width + gapX) - gapX),
    headingWidth = Math.min(diagramWidth, 1150),
    titleText = wrapLearningText(view.title, headingWidth, 30, measure),
    captionText = wrapLearningText(
      STUDY_FORMAT_NAMES[view.format] + ' · ' + view.rationale,
      headingWidth,
      16,
      measure,
    ),
    captionY = titleText.split('\n').length * 42 + 16;
  let y = captionY + captionText.split('\n').length * 23 + 48;
  const rowY = new Map();
  for (const row of rows) {
    rowY.set(row, y);
    y += Math.max(...sizes.filter((n) => n.row === row).map((n) => n.height)) + gapY;
  }
  return {
    width: diagramWidth,
    titleText,
    captionText,
    captionY,
    height: y,
    nodes: sizes.map((node) => ({
      ...node,
      x: columns.indexOf(node.column) * (width + gapX),
      y: rowY.get(node.row),
    })),
  };
}

export function studySketches(report, measure) {
  const shapes = [],
    views = studyViews(report),
    entries = {};
  let offsetY = 0;
  const colors = {
    claim: '#e6eff8',
    evidence: '#e6f1e7',
    mechanism: '#e6eff8',
    condition: '#f8f0dc',
    counterpoint: '#f5e9e4',
    concept: '#edf0e9',
    question: '#f8f0dc',
  };
  for (const view of views) {
    const layout = layoutStudyView(view, measure),
      ids = new Map(layout.nodes.map((n) => [n.id, `ss-${report.id}-${view.id}-${n.id}`]));
    const meta = (itemId, originalText = '') => ({
      systemStudy: { reportId: report.id, viewId: view.id, itemId, originalText },
    });
    shapes.push({
      type: 'text',
      id: `ss-${report.id}-${view.id}-title`,
      x: 0,
      y: offsetY,
      text: layout.titleText,
      fontFamily: 2,
      fontSize: 30,
      strokeColor: '#233c31',
      customData: meta(''),
    });
    shapes.push({
      type: 'text',
      x: 0,
      y: offsetY + layout.captionY,
      text: layout.captionText,
      fontFamily: 2,
      fontSize: 16,
      strokeColor: '#627367',
      customData: meta(''),
    });
    for (const node of layout.nodes) {
      const itemId = view.id + ':' + node.id;
      entries[itemId] = { ...node, viewTitle: view.title };
      shapes.push({
        type: 'rectangle',
        id: ids.get(node.id),
        x: node.x,
        y: offsetY + node.y,
        width: node.width,
        height: node.height,
        backgroundColor: colors[node.role] || '#edf0e9',
        fillStyle: 'solid',
        strokeColor: '#82958a',
        strokeStyle: node.origin === 'background' ? 'dashed' : 'solid',
        strokeWidth: 1.3,
        roughness: 0,
        roundness: { type: 3 },
        customData: meta(itemId, node.text),
        label: {
          text: node.text,
          fontFamily: 2,
          fontSize: 18,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: 1.4,
          strokeColor: '#25392f',
        },
      });
    }
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const border = (a, b) => {
      const ax = a.x + a.width / 2,
        ay = a.y + a.height / 2,
        dx = b.x + b.width / 2 - ax,
        dy = b.y + b.height / 2 - ay,
        ratio = Math.min(
          (a.width / 2 + 8) / Math.max(Math.abs(dx), 0.01),
          (a.height / 2 + 8) / Math.max(Math.abs(dy), 0.01),
        );
      return { x: ax + dx * ratio, y: ay + dy * ratio };
    };
    let extraRail = 0,
      drawingBottom = layout.height;
    for (const edge of view.edges) {
      const itemId = view.id + ':edge:' + edge.id;
      entries[itemId] = { ...edge, title: edge.label, viewTitle: view.title };
      const from = byId.get(edge.from),
        to = byId.get(edge.to);
      let start = border(from, to),
        end = border(to, from),
        points;
      const feedback =
        view.edges.some((other) => other.from === edge.to && other.to === edge.from) &&
        (from.x > to.x || (from.x === to.x && from.y > to.y));
      if (feedback && from.x !== to.x) {
        start = { x: from.x + from.width / 2, y: from.y + from.height + 8 };
        end = { x: to.x + to.width / 2, y: to.y + to.height + 8 };
        const rail = Math.max(start.y, end.y) + 48;
        points = [
          [0, 0],
          [0, rail - start.y],
          [end.x - start.x, rail - start.y],
          [end.x - start.x, end.y - start.y],
        ];
      } else if (feedback) {
        start = { x: from.x + from.width + 8, y: from.y + from.height / 2 };
        end = { x: to.x + to.width + 8, y: to.y + to.height / 2 };
        const rail = Math.max(start.x, end.x) + 68;
        points = [
          [0, 0],
          [rail - start.x, 0],
          [rail - start.x, end.y - start.y],
          [end.x - start.x, end.y - start.y],
        ];
      } else
        points = [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ];
      const touches = (origin, route) =>
        route
          .slice(1)
          .some((p, index) =>
            layout.nodes.some(
              (node) =>
                node.id !== from.id &&
                node.id !== to.id &&
                crossesBox(
                  { x: origin.x + route[index][0], y: origin.y + route[index][1] },
                  { x: origin.x + p[0], y: origin.y + p[1] },
                  node,
                ),
            ),
          );
      if (touches(start, points)) {
        const above = from.y > to.y;
        start = { x: from.x + from.width / 2, y: above ? from.y - 8 : from.y + from.height + 8 };
        end = { x: to.x + to.width / 2, y: above ? to.y + to.height + 8 : to.y - 8 };
        const rail = above ? from.y - 50 : from.y + from.height + 50;
        points = [
          [0, 0],
          [0, rail - start.y],
          [end.x - start.x, rail - start.y],
          [end.x - start.x, end.y - start.y],
        ];
        if (touches(start, points)) {
          start = { x: from.x + from.width + 8, y: from.y + from.height / 2 };
          end = { x: to.x + to.width + 8, y: to.y + to.height / 2 };
          const railY = layout.height + 40 + extraRail++ * 70,
            lane = 54;
          points = [
            [0, 0],
            [lane, 0],
            [lane, railY - start.y],
            [end.x - start.x + lane, railY - start.y],
            [end.x - start.x + lane, end.y - start.y],
            [end.x - start.x, end.y - start.y],
          ];
        }
      }
      drawingBottom = Math.max(drawingBottom, ...points.map((point) => start.y + point[1] + 50));
      shapes.push({
        type: 'arrow',
        id: `ss-${report.id}-${view.id}-edge-${edge.id}`,
        x: start.x,
        y: offsetY + start.y,
        points,
        start: { id: ids.get(edge.from) },
        end: { id: ids.get(edge.to) },
        endArrowhead: 'arrow',
        strokeWidth: 1.5,
        strokeColor: '#5f7769',
        roughness: 0,
        strokeStyle: edge.origin === 'source' ? 'solid' : 'dashed',
        label: {
          text: wrapLearningText(shorten(edge.label, 36), 140, 15, measure),
          fontFamily: 2,
          fontSize: 15,
        },
        customData: meta(itemId, wrapLearningText(shorten(edge.label, 36), 140, 15, measure)),
      });
    }
    offsetY += drawingBottom + 160;
  }
  return { shapes, views, entries };
}
