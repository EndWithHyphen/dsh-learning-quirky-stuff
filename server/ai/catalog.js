import { findCodex } from '../../codex-provider.js';
import { codexModels } from '../../codex-models.js';

export async function availableModels(llm, { refresh = false } = {}) {
  const result = [];
  for (const provider of llm.listProviders()) {
    try {
      for (const model of await llm.listModels(provider.id))
        result.push({
          provider: provider.id,
          id: model.id,
          name: model.name || model.id,
          providerName: provider.name || provider.id,
          vision: (model.inputModalities || []).includes('image'),
        });
    } catch {
      /* A provider that cannot list models must not hide other providers. */
    }
  }
  const bin = await findCodex();
  if (bin) {
    try {
      for (const model of await codexModels(bin, { refresh }))
        result.push({
          ...model,
          provider: 'codex-local',
          name: 'Codex · ' + model.name,
          providerName: 'Codex',
          vision: true,
          webSearch: true,
        });
    } catch (error) {
      result.push({
        provider: 'codex-local',
        id: 'unavailable',
        name: 'Codex · 无法读取模型配置',
        providerName: 'Codex',
        vision: true,
        unavailable: error.message,
      });
    }
  }
  return result;
}

export async function resolveModel(llm, route = {}) {
  const models = await availableModels(llm);
  const model = route.provider
    ? models.find(
        (model) =>
          model.provider === route.provider &&
          (model.id === route.model || (route.model === 'default' && model.configured)),
      )
    : models.find((model) => model.configured && !model.unavailable) ||
      models.find((model) => !model.unavailable);
  if (!model) throw new Error('没有可用模型，请先配置 DSH 模型或登录本机 Codex');
  if (model.unavailable) throw new Error(model.unavailable);
  return model;
}
