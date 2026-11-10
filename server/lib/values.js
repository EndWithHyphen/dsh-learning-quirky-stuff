import { createHash } from 'node:crypto';

export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const normalized = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
export const unique = (values) => [...new Set(values)];
export function requiredText(value, name, limit = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写' + name);
  if (value.length > limit) throw new Error(name + '超过长度限制');
  return value.trim();
}
export function optionalText(value, limit = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
export function publicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网址');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('只支持普通 HTTP / HTTPS 链接');
  return url.href;
}
export function parseJson(raw) {
  return typeof raw === 'string'
    ? JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, ''),
      )
    : raw;
}
export const string = { type: 'string' };
export const array = (items) => ({ type: 'array', items });
export const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const evidenceSchema = array(object({ sourceId: string, quote: string }));
export const claimSchema = object({ text: string, evidence: evidenceSchema });
export function cancelled(message = '任务已取消', code = 'USER_CANCELLED') {
  return Object.assign(new Error(message), { code });
}
