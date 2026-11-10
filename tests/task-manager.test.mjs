import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskManager } from '../server/task-manager.js';
import { FeatureConfig } from '../server/config.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function pausedStartup(t, timeoutMs) {
  const root = await mkdtemp(join(tmpdir(), 'studyboard-task-start-race-'));
  const config = await new FeatureConfig(root).init();
  const tasks = await new TaskManager(root, config, { concurrency: 1, timeoutMs }).init();
  const entered = deferred(),
    release = deferred(),
    put = tasks.repository.put.bind(tasks.repository);
  let waiting = true;
  tasks.repository.put = async (id, record) => {
    if (waiting && record.status === 'running') {
      waiting = false;
      entered.resolve();
      await release.promise;
    }
    return put(id, record);
  };
  t.after(async () => {
    release.resolve();
    await tasks.dispose();
  });
  let ran = false;
  const task = await tasks.start({
    feature: 'topics',
    key: 'startup',
    title: '等待初始状态落盘',
    run: async () => {
      ran = true;
      return '不应执行';
    },
  });
  await entered.promise;
  return { tasks, config, task, release, ran: () => ran };
}

test('初始状态落盘期间超时，不启动任务，保存超时原因并释放队列', { timeout: 5000 }, async (t) => {
  const f = await pausedStartup(t, 25),
    job = f.tasks.jobs.get(f.task.id);
  if (!job.controller.signal.aborted)
    await new Promise((resolve) => job.controller.signal.addEventListener('abort', resolve, { once: true }));
  // Only the blocked first task needs a short deadline. Disk contention in the
  // full suite must not turn the queue-release assertion into a second timeout.
  f.tasks.timeoutMs = 30000;
  const next = await f.tasks.start({
    feature: 'topics',
    key: 'next',
    title: '后续任务',
    run: async () => '继续执行',
  });
  f.release.resolve();
  await job.task;
  assert.equal(f.ran(), false);
  const result = f.tasks.get(f.task.id);
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'TASK_TIMEOUT');
  assert.ok(result.finishedAt);
  assert.equal((await f.tasks.repository.get(f.task.id)).errorCode, 'TASK_TIMEOUT');
  await f.tasks.jobs.get(next.id).task;
  assert.equal(f.tasks.get(next.id).status, 'done');
  assert.equal(f.tasks.running, 0);
});

test('初始状态落盘期间取消，不启动任务并保留用户取消原因', { timeout: 5000 }, async (t) => {
  const f = await pausedStartup(t, 30000);
  await f.tasks.cancel(f.task.id);
  f.release.resolve();
  await f.tasks.jobs.get(f.task.id).task;
  assert.equal(f.ran(), false);
  assert.equal(f.tasks.get(f.task.id).status, 'cancelled');
  assert.equal(f.tasks.get(f.task.id).errorCode, 'USER_CANCELLED');
});

test('初始状态落盘期间关闭功能，启动前重新校验开关', { timeout: 5000 }, async (t) => {
  const f = await pausedStartup(t, 30000);
  await f.config.update({ features: { topics: false } });
  f.release.resolve();
  await f.tasks.jobs.get(f.task.id).task;
  assert.equal(f.ran(), false);
  assert.equal(f.tasks.get(f.task.id).status, 'cancelled');
  assert.equal(f.tasks.get(f.task.id).errorCode, 'FEATURE_DISABLED');
});
