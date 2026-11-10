import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphInput, currentGraph, graphReferenceSources } from '../graph-data.js';
import { parseGraphReport, graphPrompt } from '../graph-ai.js';
import { studyFixture, spoFixture } from './fixture.mjs';
import { withGraphProvenance, graphSourceKey, graphSourceUrl, graphBasis } from '../src/graph-provenance.js';
import { layeredGraph } from '../src/graph-layout.js';
function fixture() {
  const boards = ['甲材料', '乙材料'].map((title, i) => ({
    id: 'note' + i,
    title,
    tags: [],
    updatedAt: '2026-11-10T00:00:00Z',
    source: { url: 'https://example.com/' + i, title: title + '原视频' },
    scene: { elements: [], files: {} },
    summaries: [
      {
        id: 'summary' + i,
        createdAt: '2026-11-09T12:00:00Z',
        kind: 'summary',
        model: 'summary-model',
        provider: 'local',
        study: structuredClone(studyFixture),
      },
    ],
  }));
  boards.forEach((board, index) => {
    board.summaries[0].study.concepts = [board.summaries[0].study.concepts[index]];
  });
  const input = buildGraphInput(boards);
  const report = {
    ...parseGraphReport(spoFixture(input), input),
    id: 'graph',
    fingerprint: input.fingerprint,
  };
  return { boards, input, report };
}
test('旧图谱动态补齐笔记、总结版本与网页出处，不重新生成或改写原关系', () => {
  const { boards, input, report } = fixture();
  for (const e of [
    ...report.entities.flatMap((e) => e.sources),
    ...report.triples.flatMap((t) => t.evidence),
  ])
    for (const key of ['url', 'materialTitle', 'summaryTitle', 'summaryModel', 'summaryProvider'])
      delete e[key];
  const before = JSON.stringify(report);
  boards[0].title = '甲材料改名';
  const fresh = buildGraphInput(boards),
    graph = currentGraph(report, fresh);
  assert.equal(fresh.fingerprint, input.fingerprint);
  assert.equal(graph.edges.length, report.triples.length);
  const source = graph.edges[0].evidence.find((e) => e.boardId === 'note0');
  assert.equal(source.boardTitle, '甲材料改名');
  assert.equal(source.summaryId, 'summary0');
  assert.equal(source.summaryModel, 'summary-model');
  assert.equal(source.url, 'https://example.com/0');
  assert.ok(source.quote);
  assert.equal(JSON.stringify(report), before);
});

test('生成预算与已有图谱的来源校验分离，未被下一次输入选中的原来源仍有效', () => {
  const { boards, report } = fixture();
  boards.push({
    id: 'large',
    title: '很多新材料',
    tags: [],
    updatedAt: '2026-11-11T00:00:00Z',
    scene: { elements: [], files: {} },
    summaries: [
      {
        id: 'large-summary',
        createdAt: '2026-11-11T00:00:00Z',
        study: {
          ...studyFixture,
          concepts: Array.from({ length: 200 }, (_, i) => ({
            ...studyFixture.concepts[0],
            id: 'large-c' + i,
            explanation: '新资料里的机制关系。'.repeat(4),
          })),
        },
      },
    ],
  });
  const input = buildGraphInput(boards);
  assert.equal(input.sources.length, 180);
  assert.equal(
    input.sources.some((source) => source.boardId === 'note0'),
    false,
  );
  const graph = currentGraph(report, input, [], graphReferenceSources(boards, report));
  assert.equal(graph.edges.length, report.triples.length);
  assert.equal(graph.invalidSourceCount, 0);
  assert.equal(graph.supersededSummaryCount, 0);
});

test('补齐历史引用元数据不会用另一条关系的引文覆盖当前引文', () => {
  const { boards, input } = fixture(),
    raw = spoFixture(input);
  const source = input.sources.find((s) => s.conceptId === 'c1');
  raw.triples.push({
    ...raw.triples[0],
    id: 'another',
    predicate: '支持',
    evidence: [{ sourceId: source.id, quote: '再查看笔记' }],
  });
  const report = { ...parseGraphReport(raw, input), id: 'quote-graph' },
    graph = currentGraph(report, input, [], graphReferenceSources(boards, report));
  for (const edge of report.triples)
    assert.deepEqual(
      graph.edges.find((item) => item.id === edge.id).evidence.map((s) => s.quote),
      edge.evidence.map((s) => s.quote),
    );
});
test('每条 SPO 保留全部来源，区分总结版本、AI 推断和没有出处的手动关系', () => {
  const { input, report } = fixture();
  let graph = currentGraph(report, input, [
    { id: 'manual', from: report.entities[0].id, to: report.entities[1].id, label: '自拟联系' },
  ]);
  const first = graph.edges[0].evidence[0];
  graph.edges[0].evidence.push({
    ...first,
    id: first.id + '-history',
    summaryId: 'older',
    createdAt: '2026-11-01T00:00:00Z',
  });
  const before = JSON.stringify(graph),
    view = withGraphProvenance(graph),
    edge = view.edges[0];
  assert.equal(view.sourceCatalog.length, 3);
  assert.equal(edge.sourceNumbers.length, 3);
  assert.match(edge.sourceLabel, /\[1\]/);
  assert.equal(edge.basis, 'AI 推断');
  assert.deepEqual(view.edges.at(-1).sourceNumbers, []);
  assert.equal(view.edges.at(-1).basis, '手动关系');
  assert.equal(JSON.stringify(graph), before);
  assert.notEqual(graphSourceKey(first), graphSourceKey({ ...first, summaryId: 'older' }));
  assert.equal(graphBasis({ ...edge, inferred: false }), 'AI 总结提取');
  assert.equal(graphSourceUrl({ url: 'javascript:alert(1)' }), null);
  assert.equal(graphSourceUrl({ url: 'https://example.com/' }), 'https://example.com/');
  const layout = layeredGraph(view.nodes, view.edges);
  assert.ok(layout.edges.every((e) => e.relationLabel && e.label.sourceLine && e.label.height >= 42));
});
test('图谱提示词保留观点归属与不确定性，AI 总结引用不伪装成原材料核实', () => {
  const { input } = fixture(),
    prompt = graphPrompt(input);
  assert.match(prompt, /kind=summary 的来源是 AI 总结/);
  assert.match(prompt, /inferred=false 仅表示来源中有该表述/);
  assert.match(prompt, /保留观点归属、时间范围、适用条件和不确定性/);
  assert.match(prompt, /不声称穷尽主题/);
});
