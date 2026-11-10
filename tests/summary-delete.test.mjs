import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { SummaryJobs } from '../model.js';
import { graphInput, parseGraphReport } from '../graph-ai.js';
import { studyFixture, spoFixture } from './fixture.mjs';
test('总结删除与恢复同步影响复习和 SPO 来源，画布、批注、进度均保留', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'summary-delete-'))).init(),
    learning = await new LearningStore(store).init(),
    board = await store.create({ title: '原笔记' }),
    summary = await store.addSummary(board.id, {
      study: studyFixture,
      text: '总结',
      annotations: [],
      assets: { S01: { dataURL: 'data:image/png;base64,AAAA' } },
    });
  await learning.annotation({
    id: board.id,
    summaryId: summary.id,
    blockId: 'concept:c1:explanation',
    start: 0,
    end: 3,
    quote: '先尝试',
    kind: 'underline',
    note: '我的备注',
  });
  await learning.enroll({ id: board.id, summaryId: summary.id });
  const card = (await learning.dashboard()).cards[0];
  await learning.review({
    cardId: card.id,
    version: 0,
    grade: 3,
    eventId: 'before-delete',
    answer: '我的回答',
  });
  const progress = structuredClone(learning.data.cards[card.id]);
  const input = await graphInput(learning);
  await learning.saveGraphReport({
    ...parseGraphReport(spoFixture(input), input),
    id: 'spo',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  assert.equal((await learning.graph()).edges.length, 1);
  const before = await store.read(board.id);
  const removed = await store.dispatch({
    action: 'setSummaryDeleted',
    id: board.id,
    summaryId: summary.id,
    deleted: true,
  });
  assert.equal(removed.meta.summaryCount, 0);
  assert.ok(removed.summary.deletedAt);
  assert.equal((await learning.dashboard()).total, 0);
  assert.equal((await learning.graph()).edges.length, 0);
  await assert.rejects(learning.enroll({ id: board.id, summaryId: summary.id }), /已删除/);
  await assert.rejects(learning.preview({ cardId: card.id }), /已删除/);
  await assert.rejects(
    learning.review({ cardId: card.id, version: progress.version, grade: 3, eventId: 'late-review' }),
    /已删除/,
  );
  await assert.rejects(
    store.addSummary(board.id, { parentSummaryId: summary.id, text: '迟到的拓展' }),
    /已删除/,
  );
  const reopened = await new LearningStore(await new LibraryStore(store.root).init()).init();
  await reopened.store.setSummaryDeleted({ id: board.id, summaryId: summary.id, deleted: false });
  const after = await reopened.store.read(board.id);
  assert.deepEqual(after.scene, before.scene);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.summaries[0].annotations, before.summaries[0].annotations);
  assert.deepEqual(after.summaries[0].assets, before.summaries[0].assets);
  assert.deepEqual(reopened.data.cards[card.id], progress);
  assert.equal((await reopened.dashboard()).total, 1);
  assert.equal((await reopened.graph()).edges.length, 1);
});
test('图谱默认只用同一范围的最新总结，历史开关显式加入旧版本', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'graph-versions-'))).init(),
    learning = await new LearningStore(store).init(),
    b = await store.create({ title: '版本' });
  const old = await store.addSummary(b.id, {
      study: studyFixture,
      text: '旧版',
      kind: 'summary',
      scope: 'board',
    }),
    latest = await store.addSummary(b.id, {
      study: studyFixture,
      text: '新版',
      kind: 'summary',
      scope: 'board',
    });
  let input = await graphInput(learning);
  assert.ok(input.sources.some((s) => s.summaryId === latest.id));
  assert.equal(
    input.sources.some((s) => s.summaryId === old.id),
    false,
  );
  assert.equal(input.coverage.hiddenHistory, 1);
  await learning.graphSettings({ includeHistory: true });
  input = await graphInput(learning);
  assert.ok(input.sources.some((s) => s.summaryId === old.id));
  await store.setSummaryDeleted({ id: b.id, summaryId: old.id, deleted: true });
  assert.equal(
    (await graphInput(learning)).sources.some((s) => s.summaryId === old.id),
    false,
  );
});

test('新总结不会筛空已保存图谱，引用仍定位旧版，真正删除来源后才隐藏', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'graph-preserve-version-'))).init(),
    learning = await new LearningStore(store).init(),
    board = await store.create({ title: '版本切换' });
  const old = await store.addSummary(board.id, {
    study: studyFixture,
    text: '原总结',
    kind: 'summary',
    scope: 'board',
  });
  const input = await graphInput(learning);
  await learning.saveGraphReport({
    ...parseGraphReport(spoFixture(input), input),
    id: 'original-graph',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  const saved = structuredClone(learning.data.graphReport),
    original = await learning.graph();
  const latest = await store.addSummary(board.id, {
    study: { ...studyFixture, title: '重新组织的学习方法' },
    text: '新总结',
    kind: 'summary',
    scope: 'board',
  });
  const nextInput = await graphInput(learning);
  assert.equal(
    nextInput.sources.some((source) => source.summaryId === old.id),
    false,
  );
  assert.equal(
    nextInput.sources.some((source) => source.summaryId === latest.id),
    true,
  );
  const after = await learning.graph();
  assert.equal(after.aiStale, true);
  assert.equal(after.supersededSummaryCount, 1);
  assert.equal(after.invalidSourceCount, 0);
  assert.deepEqual(
    after.edges.map((edge) => edge.id),
    original.edges.map((edge) => edge.id),
  );
  assert.equal(after.maps.length, original.maps.length);
  assert.ok(after.edges[0].evidence.every((source) => source.summaryId === old.id && source.superseded));
  assert.equal(after.aiReport.overview, saved.overview);
  await learning.graphSettings({ includeHistory: true });
  assert.equal((await learning.graph()).edges.length, original.edges.length);
  await learning.graphSettings({ includeHistory: false });
  assert.equal((await learning.graph()).edges.length, original.edges.length);
  assert.deepEqual(learning.data.graphReport, saved);
  await store.setSummaryDeleted({ id: board.id, summaryId: old.id, deleted: true });
  assert.equal((await learning.graph()).edges.length, 0);
  await store.setSummaryDeleted({ id: board.id, summaryId: old.id, deleted: false });
  assert.equal((await learning.graph()).edges.length, original.edges.length);
});
test('删除已完成任务的总结后，缓存不会在重新打开面板时复活它', async () => {
  const jobs = new SummaryJobs({}, {}),
    summary = { id: 's', deletedAt: new Date().toISOString() };
  jobs.jobs.set('j', {
    id: 'j',
    boardId: 'b',
    status: 'done',
    summary: { id: 's' },
    createdAt: new Date().toISOString(),
  });
  await jobs.summaryChanged(summary);
  assert.equal(jobs.latest('b'), null);
  assert.ok(jobs.get('j').summary.deletedAt);
  await jobs.summaryChanged({ ...summary, deletedAt: null });
  assert.equal(jobs.latest('b').summary.id, 's');
});
