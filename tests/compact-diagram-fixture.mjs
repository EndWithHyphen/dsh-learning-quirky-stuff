export const compactDiagram = {
  id: 'compact-flow',
  title: '从观察到验证',
  kind: 'flow',
  placement: 'overview',
  caption: '核对证据与假设，再检验解释。',
  conceptIds: ['c1'],
  nodes: ['观察', '证据与假设的系统核对', '解释', '下一步验证'].map((label, i) => ({
    id: 'n' + i,
    label,
    detail: '',
  })),
  edges: [
    { from: 'n0', to: 'n1', label: '提出问题' },
    { from: 'n1', to: 'n2', label: '比较解释、排除混淆' },
    { from: 'n2', to: 'n3', label: '设计检验' },
  ],
};
