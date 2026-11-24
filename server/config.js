import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../core.js';
import { FEATURE_IDS } from '../shared/features.js';
import { SUMMARY_PRESETS, resolveSummaryTemplate, summaryTemplates } from '../shared/summary-templates.js';
import { requiredText } from './lib/values.js';

function changeTemplate(custom, change) {
  const { id, revision } = change || {};
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,90}$/.test(id) ||
    !Number.isInteger(revision) ||
    revision < 0
  )
    throw new Error('总结模板编号或版本无效');
  if (SUMMARY_PRESETS.some((item) => item.id === id)) throw new Error('内置模板可复制后修改');
  const current = custom.find((item) => item.id === id);
  if (change.remove !== undefined && typeof change.remove !== 'boolean') throw new Error('模板操作无效');
  if (change.remove && !current) return custom;
  if (
    !change.remove &&
    current &&
    typeof change.name === 'string' &&
    current.name === change.name.trim() &&
    current.prompt === change.prompt
  )
    return custom;
  if (revision !== (current?.revision ?? 0))
    throw new Error('模板已在其他窗口修改或删除，请重新打开模板管理');
  if (change.remove) return custom.filter((item) => item.id !== id);
  const name = requiredText(change.name, '模板名称', 80);
  requiredText(change.prompt, '模板提示词', 12000);
  if (summaryTemplates(custom).some((item) => item.id !== id && item.name === name))
    throw new Error('已有同名模板，请换一个名称');
  const next = { id, name, prompt: change.prompt, revision: revision + 1 };
  return current ? custom.map((item) => (item.id === id ? next : item)) : [...custom, next];
}

function changeCommonPrompt(previous = { prompt: '', revision: 0 }, change) {
  if (typeof change.prompt !== 'string' || change.prompt.length > 12000)
    throw new Error('共用提示词最多 12000 个字符');
  if (!Number.isInteger(change.revision) || change.revision < 0) throw new Error('共用提示词版本无效');
  const prompt = change.prompt.trim() ? change.prompt : '';
  if (previous.prompt === prompt) return previous;
  if (previous.revision !== change.revision)
    throw new Error('共用提示词已在其他窗口修改，请重新打开模板管理');
  return { prompt, revision: previous.revision + 1 };
}
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
  summaryTemplate(id) {
    const template = resolveSummaryTemplate(id, this.value.summaryTemplates);
    const common = this.value.summaryTemplateCommon;
    if (common?.revision) template.common = { ...common };
    return template;
  }
  assert(id) {
    if (!this.enabled(id))
      throw Object.assign(new Error('该功能已关闭，可在功能设置中重新开启'), { code: 'FEATURE_DISABLED' });
  }
  update(request) {
    const work = this.tail.then(async () => {
      if (this.loadError) throw new Error('配置文件无法读取，未覆盖原文件');
      const next = this.get();
      if (request.summaryTemplateCommon)
        next.summaryTemplateCommon = changeCommonPrompt(
          next.summaryTemplateCommon,
          request.summaryTemplateCommon,
        );
      if (request.summaryTemplate)
        next.summaryTemplates = changeTemplate(next.summaryTemplates || [], request.summaryTemplate);
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
