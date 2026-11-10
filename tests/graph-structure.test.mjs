import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphReport, graphPrompt } from '../graph-ai.js';
import { currentGraph, graphHash } from '../graph-data.js';
import { graphProjection, layeredGraph } from '../src/graph-layout.js';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';

const main = '学习任务包括主动回忆，再结合核对反馈。';
const extra = '主动回忆可使用自我解释，自我解释揭示理解缺口。';
function fixture() {
  const sources = [main, extra].map((text, i) => ({
    id: 'note/summary/c' + i,
    boardId: 'note',
    summaryId: 'summary',
    conceptId: 'c' + i,
    kind: 'summary',
    title: '学习方法',
    text,
    textHash: graphHash(text),
    topicIds: ['topic'],
  }));
  const input = {
    sources,
    topics: [{ id: 'topic', title: '学习方法', overview: main }],
    focus: '',
    fingerprint: 'fixture',
  };
  const evidence = (i) => [{ sourceId: sources[i].id, quote: sources[i].text }];
  const raw = {
    overview: '用回忆与反馈检查学习。',
    entities: ['学习任务', '主动回忆', '核对反馈', '自我解释', '理解缺口'].map((name, i) => ({
      id: 'e' + i,
      name,
      type: 'concept',
      aliases: [],
      description: name + '在这份学习材料中的作用。',
      sourceIds: [sources[i < 3 ? 0 : 1].id],
    })),
    triples: [
      ['e0', '包括', 'e1', 0],
      ['e1', '结合', 'e2', 0],
      ['e1', '可使用', 'e3', 1],
      ['e3', '揭示', 'e4', 1],
    ].map(([subject, predicate, object, i], n) => ({
      id: 'r' + n,
      subject,
      predicate,
      object,
      explanation: '这条关系来自学习资料。',
      inferred: false,
      evidence: evidence(i),
    })),
    maps: [
      {
        id: 'm',
        title: '回忆与反馈',
        question: '如何发现理解中的遗漏？',
        takeaway: { text: '先回忆，再核对。', evidence: evidence(0) },
        topicIds: ['T1'],
        coreEntityIds: ['e0', 'e1', 'e2'],
        coreTripleIds: ['r0', 'r1'],
        groups: [
          { title: '任务', entityIds: ['e0'] },
          { title: '方法', entityIds: ['e1'] },
          { title: '反馈', entityIds: ['e2'] },
        ],
        branches: [
          {
            id: 'b',
            title: '把理解说出来',
            summary: { text: '自我解释帮助发现缺口。', evidence: evidence(1) },
            tripleIds: ['r2', 'r3'],
            groups: [
              { title: '起点', entityIds: ['e1'] },
              { title: '展开', entityIds: ['e3'] },
              { title: '发现', entityIds: ['e4'] },
            ],
          },
        ],
      },
    ],
  };
  const report = { ...parseGraphReport(raw, input), id: 'report', fingerprint: input.fingerprint };
  return { raw, input, report, graph: currentGraph(report, input) };
}
test('主干与分支引用真实三元组，默认仅展示主干，搜索可查到分支细节', () => {
  const { graph, report } = fixture(),
    map = graph.maps[0],
    before = JSON.stringify(graph);
  assert.equal(report.schemaVersion, 3);
  assert.equal(isRemoteJsonValue(graph), true);
  const core = graphProjection(graph, { mapId: map.id });
  assert.equal(core.nodes.length, 3);
  assert.equal(core.edges.length, 2);
  const branch = graphProjection(graph, { mapId: map.id, branchId: map.branches[0].id });
  assert.equal(branch.nodes.length, 3);
  assert.equal(branch.edges.length, 2);
  const found = graphProjection(graph, { mapId: map.id, query: '自我解释' });
  assert.equal(found.edges.length, 2);
  assert.ok(found.nodes.some((n) => n.title === '自我解释'));
  assert.equal(graphProjection(graph, { mapId: map.id, mode: 'triples' }).edges.length, 4);
  assert.equal(JSON.stringify(graph), before);
});
test('拒绝虚构主干引用、重复分组、无依据结论及范围外的关系', () => {
  const { input, raw } = fixture();
  for (const mutate of [
    (x) => x.maps[0].coreTripleIds.push('不存在'),
    (x) => x.maps[0].groups[1].entityIds.push('e0'),
    (x) => (x.maps[0].takeaway.evidence[0].quote = '没有出现在材料里的观点'),
    (x) => x.maps[0].coreTripleIds.push('r2'),
  ]) {
    const value = structuredClone(raw);
    mutate(value);
    assert.throws(() => parseGraphReport(value, input));
  }
});
test('分支来源变化后隐藏失效关系，仍有效的主干保持可读', () => {
  const { input, report } = fixture();
  const changed = structuredClone(input);
  changed.sources[1].textHash = 'changed';
  const graph = currentGraph(report, changed);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.maps.length, 1);
  assert.equal(graph.maps[0].branches.length, 0);
  assert.ok(graph.maps[0].takeaway);
  changed.sources[0].textHash = 'also-changed';
  assert.equal(currentGraph(report, changed).maps.length, 0);
});
test('旧版 SPO 数据继续可读，并明确提示尚未提炼主线', () => {
  const { input, raw } = fixture();
  delete raw.maps;
  const report = parseGraphReport(raw, input);
  assert.equal(report.schemaVersion, 2);
  const graph = currentGraph(report, input);
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.needsCuration, true);
});
test('不同主题可共享同一事实的多份来源，三元组去重不影响各自主线', () => {
  const { input, raw } = fixture();
  const extra = { ...input.sources[0], id: 'note2/summary/c0', boardId: 'note2', topicIds: ['topic2'] };
  input.sources.push(extra);
  input.topics.push({ id: 'topic2', title: '另一份学习资料', overview: main });
  for (const entity of raw.entities.slice(0, 3)) entity.sourceIds.push(extra.id);
  const duplicates = raw.triples
    .slice(0, 2)
    .map((edge, index) => ({
      ...edge,
      id: 'other' + index,
      evidence: [{ sourceId: extra.id, quote: main }],
    }));
  raw.triples.push(...duplicates);
  raw.maps.push({
    ...structuredClone(raw.maps[0]),
    id: 'm2',
    title: '另一份资料中的回忆与反馈',
    topicIds: ['T2'],
    takeaway: { text: '回忆结合反馈。', evidence: [{ sourceId: extra.id, quote: main }] },
    coreTripleIds: ['other0', 'other1'],
    branches: [],
  });
  const report = parseGraphReport(raw, input);
  assert.equal(report.triples.length, 4);
  assert.equal(report.maps.length, 2);
  assert.deepEqual(report.maps[0].coreTripleIds, report.maps[1].coreTripleIds);
});
test('主干节点与关系标签不重叠，窄视图保持固定文字尺寸的画幅', () => {
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: 'e' + i,
    title: '知识实体' + i,
    type: 'concept',
  }));
  const groups = [
    { title: '参与者', entityIds: ['e0', 'e1'] },
    { title: '关键机制', entityIds: ['e2', 'e3', 'e4'] },
    { title: '条件与结果', entityIds: ['e5', 'e6', 'e7'] },
  ];
  const edges = [
    [0, 2],
    [1, 2],
    [2, 3],
    [3, 4],
    [2, 5],
    [3, 6],
    [4, 7],
    [0, 6],
    [5, 2],
    [6, 7],
  ].map(([a, b], i) => ({ id: 'r' + i, from: 'e' + a, to: 'e' + b, label: i % 2 ? '依赖共同条件' : '支持' }));
  const intersects = (a, b) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const width of [640, 780, 1080]) {
    const layout = layeredGraph(nodes, edges, groups, width);
    const rectangles = layout.nodes.map((n) => ({
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      width: n.width,
      height: n.height,
    }));
    for (let i = 0; i < rectangles.length; i++)
      for (let j = i + 1; j < rectangles.length; j++)
        assert.equal(intersects(rectangles[i], rectangles[j]), false);
    for (const edge of layout.edges) {
      assert.equal(
        rectangles.some((box) => intersects(box, edge.label)),
        false,
      );
      assert.ok(edge.label.y >= 0 && edge.label.y + edge.label.height <= layout.height);
    }
    for (let i = 0; i < layout.edges.length; i++)
      for (let j = i + 1; j < layout.edges.length; j++)
        assert.equal(intersects(layout.edges[i].label, layout.edges[j].label), false);
  }
  assert.ok(layeredGraph(nodes, edges, groups, 400).width >= 640);
  for (const edge of layeredGraph(nodes, edges, groups, 700).edges)
    assert.ok(
      edge.points.some(
        (point) => Math.abs(point.x - edge.center.x) < 0.01 && Math.abs(point.y - edge.center.y) < 0.01,
      ),
      '关系词必须落在自己的连线上',
    );
});
test('图谱提示词先定义问题和主线，限制主干并保留可验证的细节', () => {
  const { input } = fixture();
  input.focus = '解释学习方法之间的配合条件';
  const prompt = graphPrompt(input);
  assert.match(prompt, /不设实体和关系的最低数量/);
  assert.match(prompt, /最多 8 个实体、10 条关系/);
  assert.match(prompt, /解释学习方法之间的配合条件/);
  assert.match(prompt, /不能随机删边/);
});
