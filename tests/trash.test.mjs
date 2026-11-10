import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore, atomicWrite } from '../core.js';
import { LearningStore } from '../learning.js';
import { CaptureServer } from '../capture-server.js';
import { studyFixture, spoFixture } from './fixture.mjs';
import { graphInput, parseGraphReport } from '../graph-ai.js';
import { SummaryJobs } from '../model.js';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'study-trash-')),
    store = await new LibraryStore(root).init(),
    learning = await new LearningStore(store).init(),
    server = new CaptureServer(store, { port: 0 });
  await server.start();
  return { root, store, learning, server };
}
test('永久删除清理笔记与备份、输入快照、复习记录及收集记录，其他笔记和共享关系保留', async (t) => {
  const { root, store, learning, server } = await setup();
  t.after(() => server.close());
  const a = await server.capture({
      requestId: 'request-delete',
      url: 'https://example.com/delete',
      title: '删除目标',
    }),
    b = await store.create({ title: '保留笔记' });
  await store.dispatch({
    action: 'addWebImage',
    id: a.id,
    url: a.url,
    requestId: 'image-delete',
    dataURL: png,
    width: 1,
    height: 1,
  });
  const summaryA = await store.addSummary(a.id, {
      study: structuredClone(studyFixture),
      text: '要清理的总结',
      inputId: 'input-delete',
    }),
    summaryB = await store.addSummary(b.id, { study: structuredClone(studyFixture), text: '保留总结' });
  await learning.enroll({ id: a.id, summaryId: summaryA.id });
  await learning.enroll({ id: b.id, summaryId: summaryB.id });
  const cards = Object.values(learning.data.cards),
    cardA = cards.find((c) => c.boardId === a.id),
    cardB = structuredClone(cards.find((c) => c.boardId === b.id));
  await learning.review({
    cardId: cardA.id,
    version: 0,
    eventId: 'review-delete',
    grade: 3,
    answer: '应删除的作答记录',
  });
  const input = await graphInput(learning);
  await learning.saveGraphReport({
    ...parseGraphReport(spoFixture(input), input),
    id: 'report',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  const graph = await learning.graph();
  await learning.link({ from: graph.nodes[0].id, to: graph.nodes[1].id, label: '共享概念之间的手动关系' });
  await atomicWrite(join(root, 'summary-inputs', 'input-delete.json'), {
    boardId: a.id,
    content: '要删除的输入',
  });
  await atomicWrite(join(root, 'summary-inputs', 'input-delete.json'), {
    boardId: a.id,
    content: '要删除的新输入',
  });
  await atomicWrite(join(root, 'graph-inputs', 'graph-delete.json'), {
    nodes: [{ sources: [{ boardId: a.id }] }],
  });
  await learning.saveGraphReport({
    id: 'graph-delete',
    connections: [],
    sourceBoardIds: [a.id, b.id],
    overview: '相关整理结果',
  });
  await store.metadata({ id: a.id, deleted: true });
  const retained = await store.read(b.id);
  await assert.rejects(learning.purge({ ids: [a.id], confirm: false }), /确认/);
  await assert.rejects(learning.purge({ ids: [a.id, b.id], confirm: true }), /回收站/);
  assert.ok(await store.read(a.id));
  const result = await learning.purge(
    { ids: [a.id], confirm: true },
    { afterDelete: (ids) => server.forgetBoards(ids) },
  );
  assert.equal(result.deleted, 1);
  await assert.rejects(store.read(a.id), (e) => e.code === 'NOTE_PURGED');
  for (const file of [
    store.boardPath(a.id),
    store.boardPath(a.id) + '.bak',
    join(root, 'summary-inputs', 'input-delete.json'),
    join(root, 'summary-inputs', 'input-delete.json.bak'),
    join(root, 'graph-inputs', 'graph-delete.json'),
  ])
    await assert.rejects(readFile(file), (e) => e.code === 'ENOENT');
  assert.deepEqual(await store.read(b.id), retained);
  assert.deepEqual(learning.data.cards[cardB.id], cardB);
  assert.equal(learning.data.cards[cardA.id], undefined);
  assert.equal(
    learning.data.reviews.some((r) => r.cardId === cardA.id),
    false,
  );
  assert.equal(learning.data.links.length, 1);
  assert.equal(learning.data.graphReport, undefined);
  assert.equal((await readFile(join(root, 'learning.json.bak'), 'utf8')).includes('应删除的作答记录'), false);
  const captureBackup = JSON.parse(await readFile(join(root, 'capture.json.bak'), 'utf8'));
  assert.equal(captureBackup.requests['request-delete'], undefined);
  await assert.rejects(
    server.capture({ requestId: 'request-delete', url: a.url, title: a.title }),
    (e) => e.code === 'NOTE_PURGED',
  );
  const again = await server.capture({
    requestId: 'request-new-note',
    url: a.url,
    title: '重新创建',
    reuse: true,
  });
  assert.notEqual(again.id, a.id);
  assert.equal((await store.read(again.id)).scene.elements.length, 0);
  const response = await fetch('http://127.0.0.1:' + server.port + '/note/purged', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + server.config.token },
    body: '{}',
  });
  assert.ok((await response.json()).ids.includes(a.id));
});
test('清理中断后重启继续完成，删除标记阻止旧客户端重新写入', async (t) => {
  const { root, store, learning, server } = await setup();
  t.after(() => server.close());
  const board = await store.create({ title: '中断恢复' });
  await store.metadata({ id: board.id, deleted: true });
  await assert.rejects(
    learning.purge(
      { ids: [board.id], confirm: true },
      {
        afterDelete: async () => {
          throw new Error('模拟中断');
        },
      },
    ),
    /模拟中断/,
  );
  assert.equal((await readdir(join(root, 'purge-pending'))).filter((n) => n.endsWith('.json')).length, 1);
  const freshStore = await new LibraryStore(root).init(),
    freshLearning = await new LearningStore(freshStore).init();
  assert.equal((await readdir(join(root, 'purge-pending'))).length, 0);
  await assert.rejects(
    freshStore.metadata({ id: board.id, deleted: false }),
    (e) => e.code === 'NOTE_PURGED',
  );
  const repeat = await freshLearning.purge({ ids: [board.id], confirm: true });
  assert.equal(repeat.deleted, 0);
  assert.equal((await freshStore.library()).boards.length, 0);
});
test('永久删除等待相关总结取消完成，并清理取消过程中迟到的输入快照', async (t) => {
  const { root, store, learning, server } = await setup();
  t.after(() => server.close());
  const board = await store.create({ source: { url: 'https://example.com/pending' } });
  await store.dispatch({ action: 'saveWebNotes', id: board.id, text: '尚在分析的文字', baseVersion: 0 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const jobs = new SummaryJobs(
    {
      attachments: {
        admitPromptContent: async (content) => {
          await gate;
          return content;
        },
      },
      llm: {
        listProviders: () => [{ id: 'fixture' }],
        listModels: async () => [{ id: 'text', inputModalities: ['text'] }],
        async *stream() {
          throw new Error('cancelled');
        },
      },
    },
    store,
  );
  const job = await jobs.start({
    id: board.id,
    revision: 0,
    provider: 'fixture',
    model: 'text',
    images: [],
    elements: [],
  });
  await store.metadata({ id: board.id, deleted: true });
  const deletion = (async () => {
    await jobs.forgetBoards([board.id]);
    return learning.purge({ ids: [board.id], confirm: true });
  })();
  assert.equal(store.purged.has(board.id), false);
  release();
  await deletion;
  await assert.rejects(readFile(join(root, 'summary-inputs', job.id + '.json')), (e) => e.code === 'ENOENT');
  assert.equal(jobs.jobs.has(job.id), false);
  await assert.rejects(store.read(board.id), (e) => e.code === 'NOTE_PURGED');
  jobs.dispose();
});
