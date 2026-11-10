import { VERSION } from './shared/version.js';
import { spawn } from 'node:child_process';
let cache, loading;
export async function codexModels(bin, { refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < 60000) return cache.value;
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ['app-server', '--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let buffer = '',
      config,
      models,
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('读取 Codex 模型配置超时，请刷新模型列表')), 15000);
    const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('无法读取本机 Codex 模型配置')));
    child.on('close', () => {
      if (!settled) finish(new Error('Codex 模型配置读取中断'));
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 4000000) return finish(new Error('Codex 模型列表过大'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error)
          return finish(
            new Error('Codex 无法读取模型配置：' + String(message.error.message || '未知错误').slice(0, 300)),
          );
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/read', params: { includeLayers: false } });
          send({ id: 3, method: 'model/list', params: { limit: 50 } });
        }
        if (message.id === 2) config = message.result?.config;
        if (message.id === 3) models = message.result?.data;
        if (config && models) {
          const chosen = config.model || models.find((m) => m.isDefault)?.model;
          const entries = models.map((m) => ({
            id: m.model || m.id,
            name: m.displayName || m.model || m.id,
            configured: (m.model || m.id) === chosen,
            reasoningEffort: m.supportedReasoningEfforts?.some(
              (e) => e.reasoningEffort === config.model_reasoning_effort,
            )
              ? config.model_reasoning_effort
              : m.defaultReasoningEffort || 'medium',
          }));
          if (!entries.some((m) => m.id === chosen))
            return finish(new Error('本机配置的 Codex 模型未出现在可用列表中，请选择可用模型'));
          entries.sort((a, b) => Number(b.configured) - Number(a.configured));
          return finish(null, entries);
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'studyboard', version: VERSION },
        capabilities: { experimentalApi: true },
      },
    });
  });
  try {
    const value = await loading;
    cache = { at: Date.now(), value };
    return value;
  } finally {
    loading = null;
  }
}
