export const passage = '公开表达扩大参与机会，讨论质量还取决于证据检验和分发规则。';
export const studyPlanFixture = {
  title: '公共判断',
  question: '开放表达在什么条件下改善公共判断？',
  rationale: '围绕条件和因果机制组织，保留论断边界。',
  boards: [{ id: 'core', title: '表达与判断', format: 'causal', purpose: '区分参与机会与结果' }],
  researchQuestions: ['公共讨论的机制'],
  historyQuestion: '通信技术怎样改变对公共讨论的解释？',
};
export function systemStudyFixture(records) {
  const source = records.find((r) => r.kind !== 'visual') || records[0];
  const evidence = source.kind === 'visual' ? [] : [{ sourceId: source.id, quote: source.text.slice(0, 30) }];
  const visualSourceIds = source.kind === 'visual' ? [source.id] : [];
  const support = { origin: 'inference', evidence, visualSourceIds };
  return {
    title: '公共判断的条件',
    question: studyPlanFixture.question,
    overview: '把表达机会、分发机制和判断结果连接起来，检查推理的边界。',
    boards: [
      {
        id: 'core',
        title: '参与如何转化为判断',
        format: 'causal',
        rationale: '核心问题涉及条件性的影响路径。',
        nodes: [
          {
            id: 'a',
            title: '表达机会',
            body: '让更多经验进入讨论。',
            role: 'concept',
            column: 0,
            row: 0,
            ...support,
          },
          {
            id: 'b',
            title: '证据检验',
            body: '用可反驳的理由比较解释。',
            role: 'condition',
            column: 1,
            row: 0,
            ...support,
          },
          {
            id: 'c',
            title: '待验证机制',
            body: '公开申诉可能影响讨论者的信任。',
            role: 'question',
            column: 1,
            row: 1,
            origin: 'background',
            evidence: [],
            visualSourceIds: [],
          },
        ],
        edges: [{ id: 'ab', from: 'a', to: 'b', label: '仍需经过', ...support }],
      },
    ],
    history: {
      applicable: false,
      reason: '当前材料不足以重建历史阶段。',
      title: '',
      format: 'timeline',
      periods: [],
    },
    nextSteps: [
      { question: '哪些制度支持有效的证据检验？', why: '为条件寻找具体机制。', sourceIds: [source.id] },
    ],
    reviewQuestions: [
      { prompt: '开放表达为何不自动改善判断？', answer: '还取决于分发、检验和回应的条件。', ...support },
    ],
  };
}
