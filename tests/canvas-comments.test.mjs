import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { digest } from '../server/lib/values.js';
import { commentSelection, commentSourceContent } from '../shared/canvas-comments.js';
import { canvasContentCount, plainCanvasText, wrapCanvasText } from '../src/canvas-text-layout.js';
import { studyFixture } from './fixture.mjs';
import { infographicFixture } from './infographic-fixture.mjs';
import { parseStudy } from '../study-schema.js';

async function fixture(t, gateway) {
  const root = await mkdtemp(join(tmpdir(), 'study-comments-')),
    store = await new LibraryStore(root).init(),
    learning = await new LearningStore(store).init();
  const calls = [],
    runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
      gateway: gateway || {
        async text(options) {
          calls.push(options);
          return { text: '证据应能排除竞争解释。', model: { provider: 'fixture', id: 'chosen-model' } };
        },
      },
    }).init();
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const note = await store.create({ title: '论证' });
  await store.save({
    id: note.id,
    baseRevision: 0,
    scene: {
      appState: {},
      files: {},
      elements: [
        {
          id: 'claim',
          type: 'text',
          text: '相关性不等于因果性',
          x: 20,
          y: 20,
          width: 240,
          height: 40,
          version: 1,
        },
        {
          id: 'private',
          type: 'text',
          text: '没有选中的内容不应进入提问',
          x: 20,
          y: 200,
          width: 240,
          height: 40,
          version: 1,
        },
      ],
    },
  });
  const request = {
    action: 'canvasComments.send',
    noteId: note.id,
    canvas: { kind: 'note' },
    threadId: randomUUID(),
    requestId: randomUUID(),
    elementIds: ['claim'],
    ask: true,
    body: '什么证据有说服力？',
  };
  request.sourceHash = digest(
    commentSourceContent(commentSelection((await store.read(note.id)).scene.elements, request.elementIds)),
  );
  return { store, learning, runtime, note, request, calls };
}
async function done(runtime, task) {
  for (let i = 0; i < 300; i++) {
    const result = runtime.tasks.get(task.id);
    if (!['running', 'queued'].includes(result.status)) return result;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('task did not settle');
}
test('组件提问只使用选中内容，记住模型，丢失响应重试不重复回答，备注不调用模型', async (t) => {
  const { runtime, request, calls } = await fixture(t);
  await runtime.execute({
    action: 'canvasComments.model',
    route: { provider: 'fixture', model: 'chosen-model' },
  });
  const result = await runtime.execute(request);
  assert.equal((await done(runtime, result.task)).status, 'done');
  const again = await runtime.execute(request);
  assert.equal(again.task.id, result.task.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route.model, 'chosen-model');
  assert.match(calls[0].prompt, /相关性不等于因果性/);
  assert.doesNotMatch(calls[0].prompt, /没有选中的内容不应/);
  await runtime.execute({ ...request, ask: false, requestId: randomUUID(), body: '再找一篇不同观点的材料' });
  const [thread] = await runtime.execute({ ...request, action: 'canvasComments.list' });
  assert.deepEqual(
    thread.messages.map((m) => m.role),
    ['question', 'assistant', 'note'],
  );
  assert.equal(calls.length, 1);
  await assert.rejects(runtime.execute({ ...request, body: '伪装成同一请求' }), /重复请求/);
  assert.equal((await runtime.backup()).canvasComments.length, 1);
});
test('移动组件保持关联；修改和删除标记来源变化；新提问拒绝旧内容', async (t) => {
  const { runtime, store, note, request } = await fixture(t);
  await runtime.execute({ ...request, ask: false });
  let board = await store.read(note.id);
  board.scene.elements[0].x += 100;
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  const list = () => runtime.execute({ ...request, action: 'canvasComments.list' });
  assert.equal((await list())[0].sourceStatus, 'current');
  board = await store.read(note.id);
  board.scene.elements[0].text = '材料新增了一个条件';
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  assert.equal((await list())[0].sourceStatus, 'changed');
  await assert.rejects(runtime.execute({ ...request, requestId: randomUUID() }), /内容已变化/);
  board = await store.read(note.id);
  board.scene.elements[0].isDeleted = true;
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  assert.equal((await list())[0].sourceStatus, 'missing');
  assert.match((await list())[0].source.text, /相关性/);
});
test('讨论跨笔记隔离；解决和关闭功能保留记录；永久删除清理讨论与任务', async (t) => {
  const { runtime, store, learning, note, request } = await fixture(t);
  await done(runtime, (await runtime.execute(request)).task);
  const other = await store.create({ title: '另一篇' });
  await assert.rejects(
    runtime.execute({ ...request, action: 'canvasComments.resolve', noteId: other.id, resolved: true }),
    /不属于当前/,
  );
  await runtime.execute({ ...request, action: 'canvasComments.resolve', resolved: true });
  await assert.rejects(runtime.execute({ ...request, requestId: randomUUID() }), /重新打开/);
  await runtime.execute({ action: 'features.update', features: { canvasComments: false } });
  await assert.rejects(runtime.execute(request), /功能已关闭/);
  await runtime.execute({ action: 'features.update', features: { canvasComments: true } });
  assert.equal((await runtime.execute({ ...request, action: 'canvasComments.list' })).length, 1);
  await store.metadata({ id: note.id, deleted: true });
  await runtime.beforePurge([note.id]);
  await learning.purge({ ids: [note.id], confirm: true });
  await runtime.purge([note.id]);
  assert.equal((await runtime.backup()).canvasComments.length, 0);
  assert.equal(runtime.tasks.list('canvasComments').length, 0);
});
test('后台回答不会覆盖同时追加的备注；组件变化保留提问快照', async (t) => {
  let release, entered;
  const started = new Promise((r) => {
    entered = r;
  });
  const { runtime, store, note, request } = await fixture(t, {
    async text() {
      entered();
      await new Promise((r) => {
        release = r;
      });
      return { text: '对旧内容的回答', model: { id: 'test' } };
    },
  });
  const task = (await runtime.execute(request)).task;
  await started;
  await runtime.execute({ ...request, requestId: randomUUID(), ask: false, body: '我的补充' });
  const board = await store.read(note.id);
  board.scene.elements[0].text = '新的内容';
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  release();
  assert.equal((await done(runtime, task)).status, 'done');
  const [thread] = await runtime.execute({ ...request, action: 'canvasComments.list' });
  assert.equal(thread.sourceStatus, 'changed');
  assert.deepEqual(
    thread.messages.map((m) => m.role),
    ['question', 'note', 'assistant'],
  );
});
test('长文字换行保留原文与段落、避开邻近组件，并排除已有卡片排版', () => {
  const original = '理解一篇材料，先找出它的核心主张。'.repeat(30) + '\n保留第二段。';
  const e = {
    id: 'long',
    type: 'text',
    x: 0,
    y: 0,
    width: 14000,
    height: 40,
    fontSize: 20,
    lineHeight: 1.25,
    text: original,
    originalText: original,
    groupIds: [],
  };
  const result = wrapCanvasText(
    e,
    [e, { id: 'image', x: 0, y: 100, width: 400, height: 100 }],
    500,
    (s, n) => [...s].length * n,
  );
  assert.equal(result.originalText, original);
  assert.equal(result.width, 420);
  assert.ok(result.text.split('\n').length > 10);
  assert.ok(result.y >= 220);
  assert.equal(result.autoResize, false);
  assert.equal(plainCanvasText({ ...e, containerId: 'box' }), false);
  assert.equal(plainCanvasText({ ...e, customData: { studyboard: { widgetId: 'card' } } }), false);
  assert.equal(plainCanvasText({ ...e, groupIds: ['group'] }), false);
});
test('一张知识卡按一个内容块计数，内部元素不会阻止旧长文字自动换行', () => {
  const card = Array.from({ length: 11 }, (_, i) => ({
    id: 'part-' + i,
    type: 'text',
    groupIds: ['card-group'],
    customData: { studyboard: { widgetId: 'card' } },
  }));
  assert.equal(
    canvasContentCount([...card, { id: 'photo', type: 'image' }, { id: 'long', type: 'text' }]),
    3,
  );
  assert.equal(canvasContentCount([...card, { id: 'deleted', type: 'text', isDeleted: true }]), 1);
  assert.equal(
    canvasContentCount([
      { id: 'frame', type: 'frame' },
      { id: 'inside', type: 'text', frameId: 'frame' },
    ]),
    1,
  );
  assert.equal(
    canvasContentCount(Array.from({ length: 13 }, (_, i) => ({ id: String(i), type: 'text' }))),
    13,
  );
});
test('系统学习和信息图使用各自已保存场景，删除父结果后拒绝新的讨论', async (t) => {
  const { runtime, store, note, request } = await fixture(t),
    scene = (await store.read(note.id)).scene;
  const report = await runtime.reports.save(
    'systemStudy',
    { title: '系统学习' },
    [],
    { noteIds: [note.id], materialIds: [] },
    { id: 'fixture' },
    { key: note.id },
  );
  await runtime.execute({
    action: 'systemStudy.saveCanvas',
    id: report.id,
    scene,
    baseRevision: 0,
    requestId: 'study-save',
  });
  const study = { ...request, canvas: { kind: 'study', id: report.id }, threadId: randomUUID(), ask: false };
  await runtime.execute(study);
  assert.equal((await runtime.execute({ ...request, action: 'canvasComments.list' })).length, 0);
  assert.equal((await runtime.execute({ ...study, action: 'canvasComments.list' })).length, 1);
  await runtime.execute({ action: 'systemStudy.deleted', id: report.id, deleted: true });
  await assert.rejects(runtime.execute({ ...study, requestId: randomUUID() }), /已删除|不可用/);
  const summary = await store.addSummary(note.id, {
    text: '信息图',
    study: parseStudy({ ...studyFixture, infographics: [infographicFixture()] }),
    provider: 'fixture',
    model: 'fixture',
  });
  await runtime.execute({
    action: 'infographics.saveCanvas',
    noteId: note.id,
    summaryId: summary.id,
    id: 'ig1',
    scene,
    baseRevision: 0,
    requestId: 'info-save',
  });
  const info = {
    ...request,
    canvas: { kind: 'infographic', id: 'ig1', summaryId: summary.id },
    threadId: randomUUID(),
    ask: false,
  };
  await runtime.execute(info);
  assert.equal((await runtime.execute({ ...info, action: 'canvasComments.list' })).length, 1);
  await store.setSummaryDeleted({ id: note.id, summaryId: summary.id, deleted: true });
  await assert.rejects(runtime.execute({ ...info, requestId: randomUUID() }), /已删除/);
});
test('框选完整包含框内组件及绑定文字，图像只随所选区域进入模型', async (t) => {
  const selection = commentSelection(
    [
      { id: 'label', type: 'text', text: '图中标签' },
      { id: 'shape', type: 'rectangle', frameId: 'frame', boundElements: [{ id: 'label', type: 'text' }] },
      { id: 'frame', type: 'frame' },
      { id: 'outside', type: 'text', text: '未选' },
    ],
    ['frame'],
  );
  assert.deepEqual(
    selection.map((e) => e.id),
    ['label', 'shape', 'frame'],
  );
  const { runtime, store, note, request, calls } = await fixture(t),
    board = await store.read(note.id);
  board.scene.elements.push({ id: 'image', type: 'image', fileId: 'f', x: 0, y: 0, width: 1, height: 1 });
  board.scene.files.f = {
    id: 'f',
    mimeType: 'image/png',
    dataURL:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
  };
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  const image = { mimeType: 'image/png', data: board.scene.files.f.dataURL.split(',')[1] },
    ask = {
      ...request,
      elementIds: ['image'],
      image,
      sourceHash: digest(
        commentSourceContent(commentSelection(board.scene.elements, ['image']), board.scene.files),
      ),
    };
  assert.equal((await done(runtime, (await runtime.execute(ask)).task)).status, 'done');
  assert.deepEqual(calls[0].images, [image]);
  assert.doesNotMatch(calls[0].prompt, /相关性不等于因果性/);
  await assert.rejects(
    runtime.execute({ ...ask, threadId: randomUUID(), requestId: randomUUID(), image: undefined }),
    /预览/,
  );
});
