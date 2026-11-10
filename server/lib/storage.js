import { mkdir, readFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, assertId } from '../../core.js';

export class JsonRepository {
  constructor(root, folder) {
    this.root = join(root, 'modules', folder);
    this.tail = Promise.resolve();
    this.cache = new Map();
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return this;
  }
  path(id) {
    return join(this.root, assertId(id) + '.json');
  }
  serial(fn) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }
  async get(id, { optional = false } = {}) {
    try {
      const file = this.path(id),
        info = await stat(file),
        signature = info.mtimeMs + ':' + info.size,
        cached = this.cache.get(id);
      if (cached?.signature === signature) return structuredClone(cached.value);
      const value = JSON.parse(await readFile(file, 'utf8'));
      this.cache.set(id, { signature, value });
      return structuredClone(value);
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async list({ tolerant = false } = {}) {
    await this.init();
    const results = [];
    for (const name of (await readdir(this.root)).filter((name) => name.endsWith('.json'))) {
      try {
        results.push(await this.get(name.slice(0, -5)));
      } catch (error) {
        if (error.code !== 'ENOENT' && !tolerant) throw new Error('学习模块数据无法读取：' + name);
      }
    }
    return results;
  }
  put(id, value) {
    return this.serial(async () => {
      await atomicWrite(this.path(id), value);
      this.cache.delete(id);
      return value;
    });
  }
  update(id, change, { optional = false } = {}) {
    return this.serial(async () => {
      const next = await change(await this.get(id, { optional }));
      await atomicWrite(this.path(id), next);
      this.cache.delete(id);
      return next;
    });
  }
  remove(id) {
    return this.serial(async () => {
      this.cache.delete(id);
      for (const path of [this.path(id), this.path(id) + '.bak'])
        await unlink(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
    });
  }
}
