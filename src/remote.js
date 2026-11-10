import { PACKAGE_NAME } from '../shared/identity.js';
const parse = (value) => {
  if (value === undefined) throw new Error('Missing RPC value');
  return value;
};
const codec = { mode: 'strict', typeSymbol: 'studyboard#json', create: () => ({ parse }) };
const methods = {
  execute: ['request'],
  models: [],
  startSummary: ['request'],
  summaryStatus: ['id'],
  cancelSummary: ['id'],
  captureInfo: [],
  capturePairing: ['request'],
};
export const remoteInfo = {
  package: PACKAGE_NAME,
  descriptors: Object.entries(methods).map(([method, args]) => ({
    id: `${PACKAGE_NAME}#studyboard/${method}`,
    service: 'studyboard',
    namespace: 'studyboard',
    method,
    invocation: { kind: 'direct' },
    parameters: args.map((name) => ({ name, wire: name, source: 'json', codec })),
    result: codec,
  })),
};
export function apiFrom(ctx) {
  return async (method, ...args) => {
    const r = await ctx.remote.studyboard[method](...args);
    if (!r.ok) throw new Error(r.error?.message || '连接 DSH 失败');
    return r.value;
  };
}
