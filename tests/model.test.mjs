import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../core.js';
import { SummaryJobs } from '../model.js';
import { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { studyFixture } from './fixture.mjs';
async function setup(failure = false) {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'studyboard-ai-test-'))).init(),
    board = await store.create({ title: '测试白板' });
  const calls = [];
  const attachments = {
    admitPromptContent: AttachmentStore.prototype.admitPromptContent,
    saveImages: async (images) =>
      images.map((i) => {
        assert.equal(i.mediaType, 'image/png');
        assert.equal(Buffer.from(i.data).toString(), 'abc');
        return { id: 'fixture-image' };
      }),
  };
  const ctx = {
    attachments,
    llm: {
      listProviders: () => [{ id: 'test' }],
      listModels: async () => [
        { id: 'vision', inputModalities: ['text', 'image'] },
        { id: 'text', inputModalities: ['text'] },
      ],
      async *stream(r) {
        calls.push(r);
        yield { type: 'text-delta', text: JSON.stringify(studyFixture) };
        yield {
          type: 'finish',
          reason: failure
            ? { kind: 'error', failure: { code: 'AUTH', message: '测试认证失败' } }
            : { kind: 'stop' },
        };
      },
    },
  };
  const jobs = new SummaryJobs(ctx, store),
    request = {
      id: board.id,
      revision: 0,
      provider: 'test',
      model: 'vision',
      images: [{ mimeType: 'image/png', data: 'YWJj' }],
      elements: [],
      scope: 'board',
    };
  return { jobs, store, board, calls, request };
}
async function settle(jobs, id) {
  for (let n = 0; n < 100; n++) {
    const j = jobs.get(id);
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not settle');
}
test('总结实际传递图像及文字，并保存来源版本与结果', async () => {
  const { jobs, store, board, calls, request } = await setup();
  const j = await jobs.start(request);
  const done = await settle(jobs, j.id);
  assert.equal(done.status, 'done');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content[1].type, 'image');
  assert.equal((await store.read(board.id)).summaries[0].sourceRevision, 0);
});
test('模型失败保留错误信息，不能保存成成功总结', async () => {
  const { jobs, store, board, request } = await setup(true);
  const j = await jobs.start(request),
    done = await settle(jobs, j.id);
  assert.equal(done.status, 'error');
  assert.match(done.error, /认证/);
  assert.equal((await store.read(board.id)).summaries.length, 0);
});
test('文本模型和过期白板版本在发出模型请求前被拒绝', async () => {
  const { jobs, calls, request } = await setup();
  await assert.rejects(jobs.start({ ...request, model: 'text' }), /图片/);
  await assert.rejects(jobs.start({ ...request, revision: 99 }), /更新/);
  assert.equal(calls.length, 0);
});

test('总结允许等待半小时；超时原因与耗时落盘，重开面板仍能查询任务', async () => {
  const { jobs, store, board, request } = await setup();
  assert.equal(jobs.timeoutMs, 30 * 60 * 1000);
  jobs.timeoutMs = 30;
  jobs.ctx.llm.stream = async function* (r) {
    await new Promise((resolve, reject) => {
      if (r.signal.aborted) reject(new Error('AbortError'));
      else r.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
    });
  };
  const j = await jobs.start(request);
  await jobs.jobs.get(j.id).task;
  const done = jobs.latest(board.id);
  assert.equal(done.status, 'error');
  assert.equal(done.stopReason, 'SUMMARY_TIMEOUT');
  assert.match(done.error, /30 分钟/);
  const saved = JSON.parse(await readFile(join(store.root, 'summary-inputs', j.id + '.json'), 'utf8'));
  assert.equal(saved.status, 'error');
  assert.equal(saved.stopReason, 'SUMMARY_TIMEOUT');
  assert.ok(saved.finishedAt);
  // Millisecond wall-clock rounding can report 29 ms for a 30 ms Node timer.
  assert.equal(saved.elapsedMs, Date.parse(saved.finishedAt) - Date.parse(saved.createdAt));
  assert.ok(saved.elapsedMs >= jobs.timeoutMs - 2);
  assert.equal((await store.read(board.id)).summaries.length, 0);
});

test('每次总结自动保留复习题，旧客户端关闭选项也不生效，超过 8 题时限制数量', async () => {
  const { jobs, store, request, calls } = await setup();
  let j = await jobs.start(request);
  await jobs.jobs.get(j.id).task;
  assert.equal(jobs.get(j.id).summary.study.questions.length, 1);
  const record = JSON.parse(await readFile(join(store.root, 'summary-inputs', j.id + '.json'), 'utf8'));
  assert.equal(record.includeReview, true);
  assert.match(calls[0].messages[0].content[0].text, /每次都生成 1～8/);
  const study = {
    ...studyFixture,
    questions: Array.from({ length: 12 }, (_, i) => ({
      ...studyFixture.questions[0],
      id: 'q' + i,
      prompt: '核心问题 ' + i,
    })),
  };
  jobs.ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify(study) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  j = await jobs.start({ ...request, includeReview: false });
  await jobs.jobs.get(j.id).task;
  assert.equal(jobs.get(j.id).summary.study.questions.length, 8);
});
test('模型漏掉有效复习题时明确报错，不保存缺题的成功结果', async () => {
  const { jobs, store, board, request } = await setup();
  jobs.ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify({ ...studyFixture, questions: [] }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const j = await jobs.start(request);
  await jobs.jobs.get(j.id).task;
  assert.equal(jobs.get(j.id).status, 'error');
  assert.match(jobs.get(j.id).error, /未生成有效的核心复习题/);
  assert.equal((await store.read(board.id)).summaries.length, 0);
});
