import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { GraphJobs, graphInput, graphPrompt, parseGraphReport } from '../graph-ai.js';
import { studyFixture, spoFixture } from './fixture.mjs';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';
async function fixture() {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'graph-ai-'))).init(),
    learning = await new LearningStore(store).init();
  for (const [title, key] of [
    ['主动回忆', 'learning/recall'],
    ['间隔复习', 'learning/spacing'],
  ]) {
    const b = await store.create({ title }),
      study = structuredClone(studyFixture);
    study.concepts = [{ ...study.concepts[0], id: 'c1', title, canonicalKey: key }];
    study.relations = [];
    study.questions = [];
    await store.addSummary(b.id, { text: title, study });
  }
  return { store, learning, input: await graphInput(learning) };
}
const output = spoFixture;
const ctx = (stream) => ({
  llm: {
    listProviders: () => [{ id: 'text-model' }],
    listModels: async () => [{ id: 'learning', name: '学习模型', inputModalities: ['text'] }],
    stream,
  },
});
test('知识图谱通过所选文字模型整理，新增关系带来源且不覆盖手动关联', async () => {
  const { store, learning, input } = await fixture();
  const initial = parseGraphReport(output(input), input);
  await learning.saveGraphReport({
    ...initial,
    id: 'initial',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  await learning.link({ from: initial.entities[0].id, to: initial.entities[1].id, label: '手动关联' });
  let request;
  const jobs = new GraphJobs(
    ctx(async function* (r) {
      request = r;
      yield { type: 'text-delta', text: JSON.stringify(output(input)) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }),
    learning,
  );
  const job = await jobs.start({ provider: 'text-model', model: 'learning' });
  for (let i = 0; i < 100 && jobs.get(job.id).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(jobs.get(job.id).status, 'done');
  assert.equal(request.provider, 'text-model');
  assert.equal(request.model, 'learning');
  assert.equal(request.messages[0].content[0].type, 'text');
  const graph = await learning.graph();
  assert.equal(graph.edges.length, 2);
  const ai = graph.edges.find((e) => e.sources.some((s) => s.kind === 'ai'));
  assert.equal(ai.evidence.length, 2);
  assert.ok(ai.evidence.every((e) => e.quote && e.boardId));
  assert.equal(ai.sources[0].inferred, true);
  assert.equal(isRemoteJsonValue(graph), true);
  const legacy = structuredClone(learning.data);
  legacy.graphSettings.enabled = false;
  await learning.commit(legacy);
  const reopened = await new LearningStore(store).init();
  assert.equal(reopened.data.graphSettings.model, 'learning');
  assert.equal((await reopened.graph()).edges.length, 2);
  assert.equal((await reopened.graph()).needsExtraction, false);
  assert.equal('enabled' in (await reopened.graph()).aiSettings, false);
  jobs.dispose();
});
test('知识图谱拒绝不存在的实体编号和伪造引文，资料中的命令不改变提取范围', async () => {
  const { input } = await fixture(),
    bad = output(input);
  bad.triples[0].object = 'invented';
  assert.throws(() => parseGraphReport(bad, input), /无效/);
  const prompt = graphPrompt(input);
  assert.match(prompt, /不调用工具/);
  assert.match(prompt, /quote 必须是该 source.text 中连续出现/);
  const forged = output(input);
  forged.triples[0].evidence[0].quote = '原文中不存在的说法';
  assert.throws(() => parseGraphReport(forged, input), /引文与原文不符/);
});
test('来源笔记移入回收站后，AI连接不再指向它，图谱结果提示需要更新', async () => {
  const { store, learning, input } = await fixture();
  await learning.saveGraphReport({
    ...parseGraphReport(output(input), input),
    id: 'graph-report',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  await store.metadata({ id: input.sources[0].boardId, deleted: true });
  const graph = await learning.graph();
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.aiStale, true);
});
test('取消知识图谱整理不保存半成品，也不丢失上一次结果', async () => {
  const { learning } = await fixture();
  await learning.saveGraphReport({ id: 'previous', connections: [] });
  let release;
  const gate = new Promise((r) => (release = r));
  const jobs = new GraphJobs(
    ctx(async function* () {
      await gate;
      yield { type: 'text-delta', text: '{}' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }),
    learning,
  );
  const job = await jobs.start({ provider: 'text-model', model: 'learning' });
  jobs.cancel(job.id);
  release();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(jobs.get(job.id).status, 'cancelled');
  assert.equal(learning.data.graphReport.id, 'previous');
  jobs.dispose();
});

test('紧凑来源编号能解析回持久化来源，别名不另造重复实体', async () => {
  const { input } = await fixture(),
    raw = output(input),
    alias = new Map(input.sources.map((s, i) => [s.id, 'R' + String(i + 1).padStart(3, '0')]));
  for (const e of raw.entities) e.sourceIds = e.sourceIds.map((id) => alias.get(id));
  for (const t of raw.triples) for (const e of t.evidence) e.sourceId = alias.get(e.sourceId);
  const report = parseGraphReport(raw, input);
  assert.equal(report.entities.length, 2);
  assert.ok(
    report.entities.every((e) =>
      e.sources.every((s) => input.sources.some((original) => original.id === s.id)),
    ),
  );
  assert.ok(report.triples[0].evidence.every((s) => s.id.includes('/')));
});

test('整理问题被记住，改变问题会提示重新整理而不覆盖已有图谱', async () => {
  const { store, learning, input } = await fixture();
  const report = {
    ...parseGraphReport(output(input), input),
    id: 'focused',
    fingerprint: input.fingerprint,
    focus: '解释两种学习方法的配合',
  };
  await learning.graphSettings({ focus: report.focus });
  await learning.saveGraphReport(report);
  assert.equal((await learning.graph()).aiStale, false);
  await learning.graphSettings({ focus: '比较两种方法的条件' });
  assert.equal((await learning.graph()).aiStale, true);
  assert.equal(learning.data.graphReport.id, 'focused');
  const reopened = await new LearningStore(store).init();
  assert.equal(reopened.data.graphSettings.focus, '比较两种方法的条件');
});
