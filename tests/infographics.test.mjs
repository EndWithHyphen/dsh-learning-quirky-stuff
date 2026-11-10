import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { SummaryJobs, buildSummaryPrompt } from '../model.js';
import { parseStudy } from '../study-schema.js';
import { normalizeInfographics } from '../shared/infographics.js';
import { infographicShapes } from '../src/infographic-layout.js';
import { studyFixture } from './fixture.mjs';
import { infographicFixture, infographicPassage } from './infographic-fixture.mjs';

async function fixture(decision = 'compose') {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'studyboard-info-test-'))).init(),
    learning = await new LearningStore(store).init();
  const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async json() {
        return {
          value: {
            decision,
            reason: decision === 'none' ? '单一事实用一句话已经清楚。' : '分组有助于区分不同条件。',
            figures: decision === 'compose' ? [infographicFixture('A-c1')] : [],
          },
          model: { provider: 'fixture', id: 'fixture' },
        };
      },
    },
  }).init();
  const note = await store.create({ title: '信息图验证' });
  const study = parseStudy({
    ...studyFixture,
    infographics: [infographicFixture()],
    visualDecision: '条件分工适合并列图解。',
  });
  const summary = await store.addSummary(note.id, {
    text: infographicPassage,
    study,
    assets: {},
    visualSources: [{ id: 'T01', kind: 'text', title: '原文', text: infographicPassage }],
    provider: 'fixture',
    model: 'fixture',
  });
  const request = { noteId: note.id, summaryId: summary.id };
  return { store, runtime, note, summary, request };
}
async function finish(runtime, task) {
  for (let i = 0; i < 200; i++) {
    const value = runtime.tasks.get(task.id);
    if (!['queued', 'running'].includes(value.status)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('任务没有结束');
}
test('按需配图：提示词不强制配额，旧总结继续兼容，伪造原图被移除', () => {
  const prompt = buildSummaryPrompt({ title: '条件', summaries: [] }, { elements: [], images: [] });
  assert.match(prompt, /不强制每篇、每节或每次/);
  assert.doesNotMatch(prompt, /生成 1 幅位于 overview/);
  assert.deepEqual(parseStudy(studyFixture).infographics, undefined);
  const figure = infographicFixture();
  figure.nodes.push({ ...figure.nodes[0], id: 'fake', kind: 'image', imageSourceId: 'S99' });
  const [parsed] = normalizeInfographics([figure], { sources: [{ id: 'T01', kind: 'text' }] });
  assert(!parsed.nodes.some((n) => n.id === 'fake'));
  assert.equal(parsed.conceptIds[0], 'c1');
});
test('自动信息图保存来源快照；关闭开关强制忽略模型返回的配图', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'studyboard-info-summary-'))).init(),
    board = await store.create({ title: '条件' });
  let enabled = true;
  const ctx = {
    attachments: { admitPromptContent: async (content) => content },
    llm: {
      listProviders: () => [{ id: 'fixture' }],
      listModels: async () => [{ id: 'vision', inputModalities: ['text', 'image'] }],
      async *stream() {
        yield {
          type: 'text-delta',
          text: JSON.stringify({ ...studyFixture, infographics: [infographicFixture()] }),
        };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    },
  };
  const jobs = new SummaryJobs(ctx, store, { infographicsEnabled: () => enabled });
  const request = {
    id: board.id,
    revision: 0,
    provider: 'fixture',
    model: 'vision',
    images: [{ mimeType: 'image/png', data: 'YWJj' }],
    elements: [{ id: 't', type: 'text', x: 0, y: 0, text: infographicPassage }],
  };
  let task = await jobs.start(request);
  await jobs.jobs.get(task.id).task;
  assert.equal(jobs.get(task.id).summary.study.infographics.length, 1);
  assert.equal(jobs.get(task.id).summary.visualSources[0].text, infographicPassage);
  enabled = false;
  task = await jobs.start(request);
  await jobs.jobs.get(task.id).task;
  assert.deepEqual(jobs.get(task.id).summary.study.infographics, []);
});
test('模型判断无需配图时保存决策，不创建空图或改动旧图', async (t) => {
  const f = await fixture('none');
  t.after(() => f.runtime.dispose());
  const result = await finish(
    f.runtime,
    await f.runtime.execute({ action: 'infographics.start', ...f.request, conceptId: 'c1' }),
  );
  assert.equal(result.status, 'done', result.error);
  assert.equal(result.result.decision, 'none');
  assert.equal((await f.runtime.execute({ action: 'infographics.list', ...f.request })).entries.length, 1);
  assert.equal((await f.runtime.repositories.infographics.list()).length, 0);
});
test('重做信息图保留旧版本与编辑，保存可重试、拒绝冲突并纳入备份', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const scene = {
    elements: [{ id: 'my-edit', type: 'text', text: '我的修正', x: 0, y: 0 }],
    files: {},
    appState: {},
  };
  const save = {
    action: 'infographics.saveCanvas',
    ...f.request,
    id: 'ig1',
    scene,
    baseRevision: 0,
    requestId: 'save-once',
  };
  assert.equal((await f.runtime.execute(save)).revision, 1);
  assert.equal((await f.runtime.execute(save)).revision, 1);
  await assert.rejects(f.runtime.execute({ ...save, requestId: 'stale' }), /另一窗口/);
  const done = await finish(
    f.runtime,
    await f.runtime.execute({
      action: 'infographics.start',
      ...f.request,
      conceptId: 'c1',
      replaceId: 'ig1',
    }),
  );
  assert.equal(done.status, 'done', done.error);
  const listing = await f.runtime.execute({ action: 'infographics.list', ...f.request });
  assert.equal(listing.entries.length, 2);
  assert.equal(listing.entries[1].slotId, 'ig1');
  assert.equal(
    (await f.runtime.execute({ action: 'infographics.get', ...f.request, id: 'ig1' })).canvas.scene
      .elements[0].text,
    '我的修正',
  );
  assert.equal(
    (await f.runtime.execute({ action: 'infographics.get', ...f.request, id: done.result.id })).canvas,
    null,
  );
  await f.runtime.execute({ action: 'infographics.visibility', ...f.request, slotId: 'ig1', visible: false });
  assert.deepEqual((await f.runtime.execute({ action: 'infographics.list', ...f.request })).hidden, ['ig1']);
  assert.equal((await f.runtime.backup()).infographicCanvases.length, 1);
  await f.store.setSummaryDeleted({ id: f.note.id, summaryId: f.summary.id, deleted: true });
  await assert.rejects(f.runtime.execute({ ...save, baseRevision: 1, requestId: 'after-delete' }), /已删除/);
  await f.store.setSummaryDeleted({ id: f.note.id, summaryId: f.summary.id, deleted: false });
  assert.equal(
    (await f.runtime.execute({ action: 'infographics.get', ...f.request, id: 'ig1' })).canvas.revision,
    1,
  );
  await f.runtime.purge([f.note.id]);
  assert.equal((await f.runtime.repositories.infographics.list()).length, 0);
  assert.equal((await f.runtime.repositories['infographic-canvases'].list()).length, 0);
});
test('原生版面为独立文字和关系线，过密文字明确报错而非缩成小字', () => {
  const figure = normalizeInfographics([infographicFixture()])[0],
    measure = (text, size) => Array.from(text).length * size;
  const sketch = infographicShapes({ id: 'test', summaryId: 's', figure }, measure);
  assert(sketch.shapes.some((s) => s.type === 'arrow'));
  assert(sketch.shapes.filter((s) => s.type === 'text').every((s) => s.fontSize >= 20));
  figure.nodes[0].text = '非常长的文字'.repeat(100);
  assert.throws(() => infographicShapes({ id: 'test', summaryId: 's', figure }, measure), /文字过密/);
});
