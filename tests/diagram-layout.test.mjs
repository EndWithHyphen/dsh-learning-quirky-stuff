import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagramLayout } from '../src/diagram-layout.js';
test('多路汇合关系图的节点互不遮挡，所有节点均位于画幅内', () => {
  const graph = {
      kind: 'flow',
      nodes: ['资本与思想资源', '领袖号召与背书', '基层与社会网络', '政策与组织协调', '可持续政治联盟'].map(
        (label, i) => ({ id: 'n' + i, label }),
      ),
      edges: [0, 1, 2].map((i) => ({ from: 'n' + i, to: 'n3' })).concat({ from: 'n3', to: 'n4' }),
    },
    layout = diagramLayout(graph);
  for (const a of layout.nodes) {
    assert.ok(a.x - a.width / 2 >= 0 && a.x + a.width / 2 <= layout.width);
    assert.ok(a.y - a.height / 2 >= 0 && a.y + a.height / 2 <= layout.height);
    for (const b of layout.nodes)
      if (a.id !== b.id)
        assert.ok(
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
        );
  }
});

test('简单关系链在宽页面横排，窄页面紧凑竖排，不靠放大节点填满画幅', async () => {
  const { compactDiagram } = await import('./compact-diagram-fixture.mjs');
  const wide = diagramLayout(compactDiagram, { availableWidth: 900 }),
    narrow = diagramLayout(compactDiagram, { availableWidth: 320 });
  assert.equal(wide.direction, 'LR');
  assert.ok(wide.height <= 100);
  assert.ok(wide.width <= 900);
  assert.equal(narrow.direction, 'TB');
  assert.ok(narrow.height < 400);
  assert.ok(narrow.width <= 320);
  assert.ok(
    new Set(wide.nodes.map((n) => n.width)).size > 1,
    'Short labels should not receive oversized uniform cards',
  );
  for (const layout of [wide, narrow])
    for (const e of layout.edges) {
      assert.ok(e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      if (e.label.width) {
        assert.ok(e.label.x - e.label.width / 2 >= 0);
        assert.ok(e.label.x + e.label.width / 2 <= layout.width);
        assert.ok(e.label.y - e.label.height / 2 >= 0);
        assert.ok(e.label.y + e.label.height / 2 <= layout.height);
      }
    }
});

test('长标题与环形关系保留完整文字，节点及关系标注均在图内', () => {
  const graph = {
    kind: 'cycle',
    nodes: ['建立共同问题', '进行调查并搜集多方面的材料', '比较已有解释的成立条件', '根据新证据更新判断'].map(
      (label, i) => ({ id: 'n' + i, label }),
    ),
    edges: [0, 1, 2, 3].map((i) => ({ from: 'n' + i, to: 'n' + ((i + 1) % 4), label: '提供下一轮的依据' })),
  };
  const layout = diagramLayout(graph, { availableWidth: 600 });
  for (const a of layout.nodes) {
    assert.equal(a.lines.join(''), a.label);
    assert.ok(a.x - a.width / 2 >= 0 && a.x + a.width / 2 <= layout.width);
    assert.ok(a.y - a.height / 2 >= 0 && a.y + a.height / 2 <= layout.height);
    for (const b of layout.nodes)
      if (a.id !== b.id)
        assert.ok(
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
        );
  }
});
