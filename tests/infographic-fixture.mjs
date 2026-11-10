export const infographicPassage =
  '公开表达机会扩大，并不自动带来共同判断。分发规则决定哪些论点进入视野；证据检验和相互回应决定哪些论点被修正。表达数量增加与判断质量提高应当区分。';
const node = (id, text, x, y, width = 370, height = 90, extra = {}) => ({
  id,
  kind: 'text',
  x,
  y,
  width,
  height,
  text,
  fontSize: 30,
  align: 'left',
  tone: 'text',
  fill: 'none',
  imageSourceId: '',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  sourceIds: ['T01'],
  origin: 'material',
  ...extra,
});
export function infographicFixture(sourceId = 'T01') {
  const figure = {
    id: 'figure',
    title: '开放表达怎样转化为共同判断',
    caption: '分发决定哪些论点被看见，检验与回应决定它们能否被修正。',
    rationale: '用两条不同性质的条件路径，区分参与机会与判断质量。',
    placement: 'inline',
    conceptIds: ['c1'],
    theme: 'navy',
    height: 1000,
    sourceIds: ['T01'],
    origin: 'material',
    nodes: [
      node('start', '表达机会扩大', 100, 410, 330, 90, { fontSize: 40, tone: 'accent', align: 'center' }),
      node('top', '分发规则', 620, 300),
      node('top-detail', '决定哪些论点进入视野', 620, 360, 430, 80, { fontSize: 25, tone: 'muted' }),
      node('bottom', '证据检验与相互回应', 620, 570, 430),
      node('bottom-detail', '检验并修正论点', 620, 635, 430, 80, { fontSize: 25, tone: 'muted' }),
      node('goal', '共同判断', 1190, 440, 330, 90, { fontSize: 40, tone: 'accent' }),
      node('boundary', '表达增加，并不自动带来判断质量提高。', 100, 785, 1350, 60, {
        fontSize: 28,
        tone: 'secondary',
      }),
    ],
    edges: [
      {
        from: 'start',
        to: 'top',
        label: '进入视野',
        arrow: 'forward',
        sourceIds: ['T01'],
        origin: 'material',
      },
      {
        from: 'bottom',
        to: 'goal',
        label: '提供条件',
        arrow: 'forward',
        sourceIds: ['T01'],
        origin: 'material',
      },
    ],
  };
  for (const target of [figure, ...figure.nodes, ...figure.edges]) target.sourceIds = [sourceId];
  return figure;
}
