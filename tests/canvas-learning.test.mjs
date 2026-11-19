import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConcept, layoutLearningCard } from '../src/learning-layout.js';
import {
  ownedCardElements,
  readCardValues,
  cardAtPoint,
  quoteFromSelection,
} from '../src/learning-card-data.js';
const owner = {
  id: 'card',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 400,
  height: 220,
  groupIds: ['g'],
  customData: {
    studyboard: {
      widget: 'concept',
      role: 'background',
      widgetId: 'card',
      groupId: 'g',
      values: { title: '旧知识点', body: '已有解释' },
    },
  },
};
test('旧卡片编辑时保留原文字及误绑定的居中文字；取消读取不修改场景', () => {
  const centered = { id: 'center', type: 'text', text: '误加内容', containerId: 'card', groupIds: ['g'] };
  const unrelated = { id: 'extra', type: 'text', text: '独立文字', groupIds: ['g'] };
  const scene = [owner, centered, unrelated],
    before = JSON.stringify(scene);
  const values = readCardValues(owner, scene);
  assert.deepEqual(values, {
    title: '',
    items: [{ id: 'legacy', title: '旧知识点', body: '已有解释\n误加内容' }],
  });
  assert.deepEqual(
    ownedCardElements(owner, scene).map((e) => e.id),
    ['card', 'center'],
  );
  assert.equal(JSON.stringify(scene), before);
});
test('知识点按编号自动排版，长内容无重叠，重排序保持字段标识', () => {
  const values = {
    title: '学习方法',
    items: [
      { id: 'a', title: '主动回忆', body: '先回忆再核对。'.repeat(40) },
      { id: 'b', title: '间隔复习', body: '安排下一次复习' },
      { id: 'c', title: '迁移', body: '' },
    ],
  };
  const layout = layoutLearningCard('concept', values, { width: 400, height: 200 });
  const content = layout.items.filter((e) => e.type === 'text' && e.field);
  for (const e of content) {
    assert.ok(e.x >= 18);
    assert.ok(e.y + e.height <= layout.height);
    assert.equal(e.textAlign, 'left');
  }
  assert.equal(
    layout.items
      .filter((e) => e.role.endsWith('-number'))
      .map((e) => e.text)
      .join(' '),
    '1. 2. 3.',
  );
  assert.ok(
    content.find((e) => e.field === 'point:b:title').y >=
      content.find((e) => e.field === 'point:a:body').y +
        content.find((e) => e.field === 'point:a:body').height,
  );
  const reordered = layoutLearningCard(
    'concept',
    { ...values, items: [values.items[1], values.items[0], values.items[2]] },
    { width: 400, height: 200 },
  );
  assert.ok(
    reordered.items.find((e) => e.field === 'point:b:title').y <
      reordered.items.find((e) => e.field === 'point:a:title').y,
  );
  assert.equal(normalizeConcept({ items: [{ id: 'x' }, { id: 'x' }] }).items[1].id, 'x-copy');
});
test('双击命中卡片背景；删除和锁定的卡片不接管编辑', () => {
  assert.equal(cardAtPoint([owner], { x: 200, y: 100 }).id, 'card');
  assert.equal(cardAtPoint([owner], { x: 500, y: 100 }), undefined);
  assert.equal(cardAtPoint([{ ...owner, isDeleted: true }], { x: 200, y: 100 }), undefined);
  assert.equal(cardAtPoint([{ ...owner, locked: true }], { x: 200, y: 100 }), undefined);
});

test('选中整组 PDF 摘录时只取未折行的正文，选中多段文字时由用户填写', () => {
  const original = '  第一行。\r\n\r\n\tKeep  the spaces.  ';
  const pdfSource = { title: '随笔', page: 8 };
  const body = {
    id: 'body',
    type: 'text',
    text: '自动折行',
    originalText: original,
    customData: { studyboard: { role: 'pdf-excerpt', pdfSource } },
  };
  const label = {
    id: 'label',
    type: 'text',
    text: '随笔 · 第 8 页',
    customData: { studyboard: { role: 'pdf-source', pdfSource } },
  };
  const other = { id: 'other', type: 'text', text: '另一段文字' };
  const scene = [label, body, other];
  assert.deepEqual(quoteFromSelection(scene, { label: true, body: true }), {
    text: original,
    source: '随笔 · 第 8 页',
  });
  assert.equal(quoteFromSelection(scene, { body: true, other: true }), null);
});

test('金句卡在窄画布折行并展开制表符时，仍保留原始换行、缩进和标点', () => {
  const text = '\t  首行，' + '没有硬换行的长句'.repeat(12) + '\r\r第二段！  ';
  const layout = layoutLearningCard('quote', { text }, { width: 270, height: 120 });
  const passage = layout.items.find((item) => item.field === 'text');
  assert.equal(passage.originalText, text);
  assert.ok(passage.text.startsWith('          首行，'));
  assert.ok(passage.text.endsWith('\n\n第二段！  '));
  assert.ok(passage.text.split('\n').length > 3);
  assert.ok(passage.y + passage.height <= layout.height);
});
