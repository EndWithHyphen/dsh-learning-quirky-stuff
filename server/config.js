import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../core.js';
import { FEATURE_IDS } from '../shared/features.js';

export class FeatureConfig {
  constructor(root) {
    this.file = join(root, 'modules', 'settings.json');
    this.tail = Promise.resolve();
    this.value = {
      version: 1,
      features: Object.fromEntries(FEATURE_IDS.map((id) => [id, true])),
      models: {},
    };
  }
  async init() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1) throw new Error('学习模块配置版本不支持');
      this.value = { ...this.value, ...saved, features: { ...this.value.features, ...saved.features } };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.loadError = error.message;
        this.value.features = Object.fromEntries(FEATURE_IDS.map((id) => [id, false]));
      }
    }
    return this;
  }
  get() {
    return {
      ...structuredClone(this.value),
      ...(this.loadError ? { error: '配置读取失败，原文件已保留：' + this.loadError } : {}),
    };
  }
  enabled(id) {
    return this.value.features[id] === true;
  }
  assert(id) {
    if (!this.enabled(id))
      throw Object.assign(new Error('该功能已关闭，可在功能设置中重新开启'), { code: 'FEATURE_DISABLED' });
  }
  update(request) {
    const work = this.tail.then(async () => {
      if (this.loadError) throw new Error('配置文件无法读取，未覆盖原文件');
      const next = this.get();
      for (const [id, enabled] of Object.entries(request.features || {})) {
        if (!FEATURE_IDS.includes(id) || typeof enabled !== 'boolean') throw new Error('功能开关不正确');
        next.features[id] = enabled;
      }
      for (const [id, route] of Object.entries(request.models || {})) {
        if (
          !FEATURE_IDS.includes(id) ||
          typeof route?.provider !== 'string' ||
          typeof route?.model !== 'string' ||
          route.provider.length > 150 ||
          route.model.length > 150
        )
          throw new Error('模型配置不正确');
        next.models[id] = { provider: route.provider, model: route.model };
      }
      await atomicWrite(this.file, next);
      this.value = next;
      return this.get();
    });
    this.tail = work.catch(() => {});
    return work;
  }
}
