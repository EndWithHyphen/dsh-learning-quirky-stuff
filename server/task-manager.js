import { randomUUID } from 'node:crypto';
import { JsonRepository } from './lib/storage.js';
import { cancelled } from './lib/values.js';

export class TaskManager {
  constructor(root, config, { concurrency = 2, timeoutMs = 1800000 } = {}) {
    this.repository = new JsonRepository(root, 'tasks');
    this.config = config;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.jobs = new Map();
    this.running = 0;
    this.disposed = false;
  }
  async init() {
    for (const record of await this.repository.list({ tolerant: true })) {
      if (['queued', 'running'].includes(record.status)) {
        record.status = 'interrupted';
        record.error = 'DSH 已重启，任务未完成，可以重新运行。';
        record.finishedAt = new Date().toISOString();
        await this.repository.put(record.id, record);
      }
      this.jobs.set(record.id, { record });
    }
    return this;
  }
  async start({ feature, title, key, references = {}, request = {}, run, once = false }) {
    this.config.assert(feature);
    const existing = [...this.jobs.values()].find(
      (job) =>
        job.record.feature === feature &&
        job.record.key === key &&
        (once || ['queued', 'running'].includes(job.record.status)),
    );
    if (existing) return this.view(existing);
    if (
      [...this.jobs.values()].filter((job) => ['queued', 'running'].includes(job.record.status)).length >= 30
    )
      throw new Error('任务较多，请等待当前任务完成');
    const id = randomUUID(),
      record = {
        id,
        feature,
        title,
        key,
        references,
        request: JSON.parse(JSON.stringify(request)),
        status: 'queued',
        phase: '等待开始',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result: null,
        error: null,
      };
    const job = { record, controller: new AbortController(), run };
    this.jobs.set(id, job);
    await this.persist(job);
    this.drain();
    return this.view(job);
  }
  view(job) {
    return JSON.parse(JSON.stringify(job.record));
  }
  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('任务不存在');
    return this.view(job);
  }
  active() {
    return [...this.jobs.values()]
      .filter((job) => ['queued', 'running'].includes(job.record.status))
      .map((job) => this.view(job));
  }
  list(feature) {
    return [...this.jobs.values()]
      .filter((job) => !feature || job.record.feature === feature)
      .map((job) => this.view(job))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 80);
  }
  persist(job) {
    job.record.updatedAt = new Date().toISOString();
    return this.repository.put(job.record.id, structuredClone(job.record));
  }
  drain() {
    if (this.disposed) return;
    for (const job of this.jobs.values()) {
      if (this.running >= this.concurrency) break;
      if (job.record.status !== 'queued' || !job.run) continue;
      this.running++;
      job.record.status = 'running';
      job.task = this.execute(job).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }
  async execute(job) {
    const { signal } = job.controller;
    const timer = setTimeout(
      () => job.controller.abort(cancelled('任务超过 30 分钟仍未完成，请缩小范围后重试。', 'TASK_TIMEOUT')),
      this.timeoutMs,
    );
    const assertActive = () => {
      signal.throwIfAborted();
      this.config.assert(job.record.feature);
    };
    try {
      assertActive();
      job.record.startedAt = new Date().toISOString();
      job.record.phase = '正在准备资料';
      await this.persist(job);
      // Cancellation may happen while the initial state is being written.
      // Do not invoke a callback that would subscribe after the abort event.
      assertActive();
      const result = await job.run({
        signal,
        assertActive,
        progress: (phase) => {
          if (job.record.status !== 'running') return;
          job.record.phase = phase;
          this.persist(job).catch(() => {});
        },
        taskId: job.record.id,
      });
      assertActive();
      job.record.result = result ?? null;
      job.record.status = 'done';
      job.record.phase = '已完成';
    } catch (error) {
      const cause = signal.aborted ? signal.reason : error;
      job.record.status = [
        'USER_CANCELLED',
        'FEATURE_DISABLED',
        'SOURCE_REMOVED',
        'SERVICE_STOPPED',
      ].includes(cause?.code)
        ? 'cancelled'
        : 'error';
      job.record.error = cause?.message || '任务失败';
      if (cause?.details) job.record.details = cause.details;
      job.record.errorCode = cause?.code || 'TASK_FAILED';
    } finally {
      clearTimeout(timer);
      job.record.finishedAt = new Date().toISOString();
      job.record.elapsedMs = Date.now() - Date.parse(job.record.startedAt || job.record.createdAt);
      await this.persist(job).catch((error) => {
        job.record.status = 'error';
        job.record.error = '任务记录保存失败：' + error.message;
      });
      job.run = null;
    }
  }
  async cancel(id, reason = cancelled()) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('任务不存在');
    if (['queued', 'running'].includes(job.record.status)) {
      job.controller?.abort(reason);
      if (job.record.status === 'queued') {
        job.record.status = 'cancelled';
        job.record.error = reason.message;
        job.record.errorCode = reason.code;
        job.record.finishedAt = new Date().toISOString();
        await this.persist(job);
      }
    }
    return this.view(job);
  }
  async cancelWhere(predicate, reason) {
    const jobs = [...this.jobs.values()].filter((job) => predicate(job.record));
    await Promise.all(jobs.map((job) => this.cancel(job.record.id, reason)));
    await Promise.allSettled(jobs.map((job) => job.task));
  }
  async removeReferences(noteIds) {
    const owns = (record) => record.references.noteIds?.some((id) => noteIds.includes(id));
    await this.cancelWhere(owns, cancelled('来源笔记已永久删除', 'SOURCE_REMOVED'));
    for (const [id, job] of this.jobs)
      if (owns(job.record)) {
        await this.repository.remove(id);
        this.jobs.delete(id);
      }
  }
  dispose() {
    this.disposed = true;
    for (const job of this.jobs.values())
      job.controller?.abort(cancelled('DSH 服务已停止', 'SERVICE_STOPPED'));
    return Promise.allSettled([...this.jobs.values()].map((job) => job.task));
  }
}
