import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { STUDY_PLAN_SCHEMA, SYSTEM_STUDY_SCHEMA } from '../server/system-study/schema.js';
import { validateStudy } from '../server/system-study/validation.js';
import { layoutStudyView, studyViews } from '../src/system-study-layout.js';
import { parseArticle } from '../server/integrations/web-reader.js';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';

import { passage, studyPlanFixture, systemStudyFixture } from './system-study-fixture.mjs';
function inputRecords(prompt) {
  const start = prompt.lastIndexOf('资料：') + 3;
  return JSON.parse(prompt.slice(start, prompt.indexOf('\n输出：', start)));
}
async function fixture(change, overrides = {}) {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'system-study-test-'))).init(),
    learning = await new LearningStore(store).init();
  const prompts = [];
  const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async json(options) {
        prompts.push(options);
        const value =
          options.schema === STUDY_PLAN_SCHEMA
            ? structuredClone(studyPlanFixture)
            : systemStudyFixture(inputRecords(options.prompt));
        if (change) await change(value, options);
        return { value, model: { provider: 'fixture', id: 'fixture', name: '测试模型' } };
      },
    },
    ...overrides,
  }).init();
  const note = await store.create({ title: '公共讨论' });
  await store.save({
    id: note.id,
    baseRevision: 0,
    scene: {
      elements: [
        { id: 'text1', type: 'text', x: 0, y: 0, width: 300, height: 100, text: passage, version: 1 },
      ],
      appState: {},
      files: {},
    },
  });
  const start = (extra = {}) =>
    runtime.execute({
      action: 'systemStudy.start',
      noteId: note.id,
      revision: 1,
      related: false,
      images: [],
      history: true,
      ...extra,
    });
  return { store, learning, runtime, note, start, prompts };
}
async function done(runtime, task) {
  for (let i = 0; i < 300; i++) {
    const next = runtime.tasks.get(task.id);
    if (!['queued', 'running'].includes(next.status)) return next;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('任务未结束');
}
test('系统学习先选择表达形式，再生成带来源的结构，结果可用于复习', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const task = await done(f.runtime, await f.start());
  assert.equal(task.status, 'done', task.error);
  assert.equal(f.prompts.length, 2);
  assert.equal(f.prompts[0].schema, STUDY_PLAN_SCHEMA);
  assert.equal(f.prompts[1].schema, SYSTEM_STUDY_SCHEMA);
  assert.match(f.prompts[0].prompt, /每次都比较候选形式/);
  assert.match(f.prompts[1].prompt, /不能|不要把后见/);
  const { report, canvas } = await f.runtime.execute({ action: 'systemStudy.get', id: task.result.reportId });
  assert.equal(canvas, null);
  assert.equal(report.value.boards[0].nodes[2].origin, 'background');
  assert.equal(report.value.boards[0].nodes[0].evidence[0].boardId, f.note.id);
  assert.ok(isRemoteJsonValue(report));
  await f.runtime.execute({ action: 'systemStudy.enroll', id: report.id, index: 0 });
  assert.equal((await f.learning.dashboard()).total, 1);
});
test('编辑白板单独保存，拒绝旧版本覆盖，删除恢复保留编辑并纳入备份', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const task = await done(f.runtime, await f.start()),
    id = task.result.reportId;
  const scene = {
    elements: [{ id: 'edited', type: 'text', text: '我的修正判断', x: 1, y: 2 }],
    files: {},
    appState: {},
  };
  const saved = await f.runtime.execute({
    action: 'systemStudy.saveCanvas',
    id,
    scene,
    baseRevision: 0,
    requestId: 'first-save',
  });
  assert.equal(saved.revision, 1);
  assert.equal(
    (
      await f.runtime.execute({
        action: 'systemStudy.saveCanvas',
        id,
        scene,
        baseRevision: 0,
        requestId: 'first-save',
      })
    ).revision,
    1,
  );
  await assert.rejects(
    f.runtime.execute({ action: 'systemStudy.saveCanvas', id, scene, baseRevision: 0 }),
    /另一窗口/,
  );
  assert.equal((await f.store.read(f.note.id)).scene.elements[0].text, passage);
  assert.equal((await f.runtime.backup()).studyCanvases[0].scene.elements[0].text, '我的修正判断');
  await f.runtime.execute({ action: 'systemStudy.deleted', id, deleted: true });
  assert.equal((await f.runtime.execute({ action: 'systemStudy.get', id })).report.value, null);
  await assert.rejects(
    f.runtime.execute({ action: 'systemStudy.saveCanvas', id, scene, baseRevision: 1 }),
    /已删除/,
  );
  await f.runtime.execute({ action: 'systemStudy.deleted', id, deleted: false });
  assert.equal(
    (await f.runtime.execute({ action: 'systemStudy.get', id })).canvas.scene.elements[0].text,
    '我的修正判断',
  );
  await f.runtime.purge([f.note.id]);
  assert.equal((await f.runtime.repositories['study-canvases'].list()).length, 0);
  assert.equal((await f.runtime.repositories.reports.list()).length, 0);
});
test('无原文支撑的引文被拒绝，不能用模型补充冒充已核实资料', async (t) => {
  const f = await fixture((value, options) => {
    if (options.schema === SYSTEM_STUDY_SCHEMA)
      value.boards[0].nodes[0].evidence = [{ sourceId: 'R001', quote: '材料从未出现的内容' }];
  });
  t.after(() => f.runtime.dispose());
  const task = await done(f.runtime, await f.start());
  assert.equal(task.status, 'error');
  assert.match(task.error, /原文不一致/);
  assert.equal((await f.runtime.repositories.reports.list()).length, 0);
});
test('历史阶段禁止引用已知晚近证据，无日期资料标回溯重建', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const records = [
    { id: 'historic', ref: 'R001', kind: 'material', text: passage, publishedAt: '2023-07-27' },
  ];
  const value = systemStudyFixture([{ id: 'R001', kind: 'material', text: passage }]);
  const era = {
    id: 'early',
    label: '1968',
    cutoffYear: 1968,
    problem: '如何共同讨论？',
    availableKnowledge: '交互式计算。',
    explanation: '通过共同模型理解分歧。',
    unknown: '后来的大规模平台经验。',
    laterRevision: '后来检验分发规则。',
    evidence: [{ sourceId: 'R001', quote: passage }],
    laterEvidence: [],
  };
  value.history = {
    applicable: true,
    reason: '比较解释变化。',
    title: '理论的形成与修正',
    format: 'comparison',
    periods: [era, { ...era, id: 'late', label: '2024', cutoffYear: 2024 }],
  };
  assert.throws(
    () =>
      validateStudy(value, { sources: f.runtime.sources, records, history: true, plan: studyPlanFixture }),
    /截止年之后/,
  );
  delete records[0].publishedAt;
  const valid = validateStudy(value, {
    sources: f.runtime.sources,
    records,
    history: true,
    plan: studyPlanFixture,
  });
  assert.equal(valid.history.periods[0].dateStatus, 'retrospective');
  assert.equal(studyViews({ value: valid }).at(-1).nodes.length, 4);
  assert.equal(
    validateStudy(value, { sources: f.runtime.sources, records, history: false, plan: studyPlanFixture })
      .history.periods.length,
    0,
  );
});
test('关闭功能取消任务，排队与运行任务不会继续生成', async (t) => {
  let release;
  const wait = new Promise((resolve) => (release = resolve));
  const f = await fixture(async (_value, options) => {
    if (options.schema === STUDY_PLAN_SCHEMA) await wait;
  });
  t.after(() => f.runtime.dispose());
  const task = await f.start();
  await f.runtime.execute({ action: 'features.update', features: { systemStudy: false } });
  release();
  const ended = await done(f.runtime, task);
  assert.equal(ended.status, 'cancelled');
  await assert.rejects(f.start(), (e) => e.code === 'FEATURE_DISABLED');
  assert.equal((await f.runtime.repositories.reports.list()).length, 0);
});
test('没有文字的白板可以用图像来源，修改原图后标记过期', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  await f.store.save({
    id: f.note.id,
    baseRevision: 1,
    scene: {
      elements: [
        {
          id: 'ink',
          type: 'freedraw',
          x: 0,
          y: 0,
          points: [
            [0, 0],
            [10, 10],
          ],
          width: 10,
          height: 10,
        },
      ],
      files: {},
      appState: {},
    },
  });
  const task = await done(
    f.runtime,
    await f.start({ revision: 2, images: [{ mimeType: 'image/png', data: 'eA==' }], elementIds: ['ink'] }),
  );
  assert.equal(task.status, 'done', task.error);
  let { report } = await f.runtime.execute({ action: 'systemStudy.get', id: task.result.reportId });
  assert.equal(report.unavailable, false);
  assert.equal(report.sources[0].kind, 'visual');
  const board = await f.store.read(f.note.id);
  board.scene.elements[0].points.push([20, 30]);
  await f.store.save({ id: f.note.id, baseRevision: 2, scene: board.scene });
  ({ report } = await f.runtime.execute({ action: 'systemStudy.get', id: task.result.reportId }));
  assert.equal(report.stale, true);
});
test('布局按模型的语义网格变化，长文本不与相邻行重叠', () => {
  const measure = (value, size) => [...value].length * size;
  const value = systemStudyFixture([{ id: 'R001', kind: 'canvas', text: passage }]);
  const comparison = { ...value.boards[0], format: 'comparison' };
  comparison.nodes[0].body = passage.repeat(7);
  const layout = layoutStudyView(comparison, measure),
    [a, b, c] = layout.nodes;
  assert.equal(a.y, b.y);
  assert.ok(c.y > a.y + a.height);
  assert.equal(b.x, c.x);
  comparison.nodes[2].column = 2;
  comparison.nodes[2].row = 0;
  const next = layoutStudyView(comparison, measure);
  assert.equal(next.nodes[2].y, a.y);
  assert.ok(next.nodes[2].x > b.x);
});
test('网页发布日期来自元数据，非法日历日期不作为年代依据', () => {
  const body = '<article><h1>研究</h1><p>' + passage.repeat(30) + '</p></article>';
  assert.equal(
    parseArticle(
      '<meta property="article:published_time" content="2000-01-01T10:00:00Z">' + body,
      'https://example.test',
    ).publishedAt,
    '2000-01-01',
  );
  assert.equal(
    parseArticle(
      '<meta property="article:published_time" content="2000-02-31">' + body,
      'https://example.test',
    ).publishedAt,
    null,
  );
});
