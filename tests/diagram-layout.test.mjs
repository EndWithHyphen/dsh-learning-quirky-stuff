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
