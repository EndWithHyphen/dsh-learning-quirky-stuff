export const studyFixture = {
  version: 2,
  title: '主动回忆',
  overview: '把知识从记忆中提取出来。',
  concepts: [
    {
      id: 'c1',
      title: '主动回忆',
      canonicalKey: '认知心理学/主动回忆',
      explanation: '先尝试自己回答，再查看笔记。',
      example: '关上笔记解释刚学的概念。',
      prerequisites: [],
    },
    {
      id: 'c2',
      title: '间隔复习',
      canonicalKey: '认知心理学/间隔复习',
      explanation: '隔一段时间再回忆。',
      example: '根据掌握程度安排下次复习。',
      prerequisites: ['主动回忆'],
    },
  ],
  relations: [{ from: 'c1', to: 'c2', label: '配合使用' }],
  diagrams: [
    {
      id: 'd1',
      title: '学习过程',
      kind: 'flow',
      nodes: [
        { id: 'a', label: '回忆', detail: '' },
        { id: 'b', label: '核对', detail: '' },
      ],
      edges: [{ from: 'a', to: 'b', label: '随后' }],
      caption: '先回忆再核对。',
      conceptIds: ['c1'],
    },
  ],
  questions: [
    {
      id: 'q1',
      kind: 'recall',
      prompt: '主动回忆的顺序是什么？',
      answer: '先尝试自己回答，再查看笔记。',
      hint: '先不看笔记。',
      conceptIds: ['c1'],
    },
  ],
  extensions: [{ topic: '应用', question: '怎样用于读论文？' }],
};

export function spoFixture(input) {
  const list = input.sources.filter((s) => s.conceptId),
    names = [...new Set(list.map((s) => s.title))].slice(0, 2),
    groups = names.map((name) => list.filter((s) => s.title === name));
  return {
    overview: '两种学习方法可以在复习中结合。',
    entities: names.map((name, i) => ({
      id: 'e' + i,
      name,
      type: 'concept',
      aliases: [],
      description: groups[i][0].text,
      sourceIds: groups[i].map((s) => s.id),
    })),
    triples: [
      {
        id: 'r1',
        subject: 'e0',
        predicate: '配合使用',
        object: 'e1',
        explanation: '可以在有间隔的复习中主动提取知识。',
        inferred: true,
        evidence: groups.map((g) => ({ sourceId: g[0].id, quote: g[0].text })),
      },
    ],
    maps: [
      {
        id: 'm1',
        title: '学习方法的配合',
        question: '如何把主动回忆与间隔复习结合？',
        takeaway: {
          text: '在有间隔的复习中主动提取知识。',
          evidence: groups.map((g) => ({ sourceId: g[0].id, quote: g[0].text })),
        },
        topicIds: input.topics.map((topic) => topic.id),
        coreEntityIds: ['e0', 'e1'],
        coreTripleIds: ['r1'],
        groups: [
          { title: '主动提取', entityIds: ['e0'] },
          { title: '时间安排', entityIds: ['e1'] },
        ],
        branches: [],
      },
    ],
  };
}
