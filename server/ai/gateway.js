import { runCodex } from '../../codex-provider.js';
import { resolveModel } from './catalog.js';
import { parseJson } from '../lib/values.js';

export function validateShape(value, schema, path = '结果') {
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && actual !== schema.type) throw new Error(path + '格式不正确');
  if (schema.enum && !schema.enum.includes(value)) throw new Error(path + '的取值不支持');
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) throw new Error(path + '缺少 ' + key);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties[key]) validateShape(child, schema.properties[key], path + '.' + key);
      else if (schema.additionalProperties === false) throw new Error(path + '包含未知字段 ' + key);
    }
  }
  if (schema.type === 'array') {
    if (
      (schema.minItems != null && value.length < schema.minItems) ||
      (schema.maxItems != null && value.length > schema.maxItems)
    )
      throw new Error(path + '的数量不正确');
    value.forEach((child, index) => validateShape(child, schema.items, path + '[' + index + ']'));
  }
  return value;
}

/** Model transport only; feature modules own prompts, schemas and interpretation. */
export class ModelGateway {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async text({
    route,
    modelInfo,
    prompt,
    schema,
    images = [],
    content,
    signal,
    progress = () => {},
    webSearch = false,
    maxTokens = 9000,
  }) {
    const model = modelInfo || (await resolveModel(this.ctx.llm, route));
    signal?.throwIfAborted();
    if (images.length && !model.vision) throw new Error('请选择支持图片的模型');
    if (webSearch && model.provider !== 'codex-local')
      throw new Error('联网探索请在模型列表中选择本机 Codex；其他模型可分析已导入的资料');
    let text = '';
    if (model.provider === 'codex-local') {
      text = await runCodex({
        prompt,
        schema,
        images,
        model: model.id,
        reasoningEffort: model.reasoningEffort,
        signal,
        webSearch: webSearch ? 'live' : 'disabled',
        onProgress: progress,
      });
    } else {
      const parts = [
        { type: 'text', text: prompt },
        ...images.map((image) => ({ type: 'image', data: image.data, mediaType: image.mimeType })),
      ];
      const admitted =
        content || (images.length ? await this.ctx.attachments.admitPromptContent(parts) : parts);
      let finish;
      for await (const chunk of this.ctx.llm.stream({
        provider: model.provider,
        model: model.id,
        messages: [{ role: 'user', content: admitted }],
        maxTokens,
        signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text;
        if (chunk.type === 'finish') finish = chunk.reason;
      }
      if (finish?.kind !== 'stop')
        throw new Error(
          finish?.failure?.message ||
            (finish?.kind === 'max-tokens' ? '模型输出达到长度上限，请缩小范围后重试' : '模型未完成任务'),
        );
    }
    signal?.throwIfAborted();
    return {
      text,
      model: {
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoningEffort: model.reasoningEffort || null,
      },
    };
  }
  async json(options) {
    const result = await this.text(options);
    let value;
    try {
      value = parseJson(result.text);
      validateShape(value, options.schema);
    } catch (error) {
      throw new Error('模型返回的结构不完整，请重试。' + error.message);
    }
    return { ...result, value };
  }
}
