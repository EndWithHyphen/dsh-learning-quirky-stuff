import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceImageCatalog, sourceAssets, originalSummaryElements } from '../summary-sources.js';
import { codexArgs } from '../codex-provider.js';
import { parseStudy, blockTexts, studyText, legacyStudy } from '../study-schema.js';
import { studyFixture } from './fixture.mjs';
test('原图只能引用选区内真实图片，保存快照不受后续画布删图影响', () => {
  const image = { id: 'image-1', type: 'image', fileId: 'file1', x: 1, y: 2, width: 100, height: 80 },
    board = { scene: { elements: [image], files: { file1: { dataURL: 'data:image/png;base64,AAAA' } } } };
  assert.equal(sourceImageCatalog([image])[0].id, 'S01');
  const assets = sourceAssets({ sourceFigures: [{ sourceId: 'S01' }] }, board, [image]);
  board.scene.files = {};
  assert.equal(assets.S01.dataURL, 'data:image/png;base64,AAAA');
  assert.throws(() => sourceAssets({ sourceFigures: [{ sourceId: 'S02' }] }, board, [image]), /不存在/);
});
test('重新总结自动排除放回画布的旧 AI总结，保留用户原笔记', () => {
  const original = { id: 'original', type: 'text', text: '用户观点' },
    generated = { id: 'generated', type: 'text', originalText: '旧总结\n第一点', containerId: 'box' },
    box = { id: 'box', type: 'rectangle' },
    tagged = { id: 'tagged', type: 'image', customData: { studyboard: { summaryId: 's' } } };
  assert.deepEqual(
    originalSummaryElements([original, generated, box, tagged], [{ text: '# 旧总结\n第一点' }]),
    [original],
  );
});
test('专题引用与批注使用规范编号，旧版兼容，空复习不产生自测栏目', () => {
  const s = parseStudy({
    ...studyFixture,
    takeaways: ['要点'],
    scopeNote: '范围',
    sourceFigures: [{ sourceId: 'S01', title: '图', caption: '图注', conceptIds: ['c2'] }],
    insights: [{ title: '洞见', text: '关联推断', conceptIds: ['c1'] }],
    questions: [],
  });
  assert.equal(s.version, 3);
  assert.equal(legacyStudy({ study: s }), s);
  assert.equal(s.sourceFigures[0].conceptIds[0], 'c2');
  assert.equal(blockTexts(s)['figure:f1:caption'], '图注');
  assert.equal(blockTexts(s)['insight:i1'], '关联推断');
  assert.doesNotMatch(studyText(s), /## 自测/);
});
test('Codex 总结明确传入所选模型与推理强度，同时保持工具隔离', () => {
  const args = codexArgs('/tmp/test', 'schema.json', 'result.json', [], 'gpt-6-astra', 'max');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="max"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('read-only'));
  assert.ok(args.includes('multi_agent'));
});
