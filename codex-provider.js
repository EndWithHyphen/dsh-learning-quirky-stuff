import { spawn } from 'node:child_process';
import { access, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { codexModels } from './codex-models.js';

export async function findCodex() {
  const candidates = [
    process.env.STUDYBOARD_CODEX_BIN,
    join(homedir(), '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    ...(process.env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .flatMap((p) =>
        process.platform === 'win32' ? ['codex.exe'].map((name) => join(p, name)) : [join(p, 'codex')],
      ),
  ].filter(Boolean);
  for (const p of [...new Set(candidates)])
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {}
  return null;
}
export function codexArgs(
  dir,
  schemaFile,
  outputFile,
  imagePaths,
  model,
  reasoningEffort,
  webSearch = 'disabled',
) {
  const args = [
    'exec',
    '--ignore-user-config',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--json',
    '--cd',
    dir,
    '--output-schema',
    schemaFile,
    '--output-last-message',
    outputFile,
    '-c',
    'approval_policy="never"',
    '-c',
    'web_search=' + JSON.stringify(webSearch === 'live' ? 'live' : 'disabled'),
  ];
  for (const feature of [
    'shell_tool',
    'apps',
    'plugins',
    'multi_agent',
    'hooks',
    'browser_use',
    'browser_use_external',
    'computer_use',
    'image_generation',
    'view_image',
    'skill_search',
    'code_mode_host',
  ])
    if (!(feature === 'code_mode_host' && webSearch === 'live')) args.push('--disable', feature);
  args.push('--enable', 'skip_host_skill_discovery');
  if (webSearch === 'live') args.push('--enable', 'code_mode_host');
  for (const p of imagePaths) args.push('--image', p);
  if (model) args.push('--model', model);
  if (reasoningEffort) args.push('-c', 'model_reasoning_effort=' + JSON.stringify(reasoningEffort));
  args.push('-');
  return args;
}
export function codexAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name !== 'AbortError') return reason;
  return new Error('已取消 Codex 任务');
}
export async function runCodex({
  prompt,
  images = [],
  schema,
  signal,
  onProgress = () => {},
  bin,
  model,
  reasoningEffort,
  onMetadata = () => {},
  webSearch = 'disabled',
}) {
  bin = bin || (await findCodex());
  if (!bin) throw new Error('没有找到本机 Codex CLI，请先安装并运行 codex login');
  if (!model || model === 'default') {
    const config = (await codexModels(bin)).find((m) => m.configured);
    model = config.id;
    reasoningEffort = reasoningEffort || config.reasoningEffort;
  }
  onMetadata({ model, reasoningEffort: reasoningEffort || 'default' });
  const dir = await mkdtemp(join(tmpdir(), 'studyboard-codex-'));
  try {
    const schemaFile = join(dir, 'schema.json'),
      outputFile = join(dir, 'result.json'),
      imagePaths = [];
    await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o600 });
    for (let i = 0; i < images.length; i++) {
      const p = join(dir, `board-${i}.${images[i].mimeType === 'image/png' ? 'png' : 'jpg'}`);
      await writeFile(p, Buffer.from(images[i].data, 'base64'), { mode: 0o600 });
      imagePaths.push(p);
    }
    const result = await new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const child = spawn(
        bin,
        codexArgs(dir, schemaFile, outputFile, imagePaths, model, reasoningEffort, webSearch),
        {
          cwd: dir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'studyboard' },
        },
      );
      let stderr = '',
        buffer = '',
        lastMessage = '',
        settled = false,
        killTimer;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        clearTimeout(killTimer);
        err ? reject(err) : resolve(value);
      };
      const abort = () => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', (e) => finish(new Error('启动 Codex 失败：' + e.message)));
      child.stderr.on('data', (d) => {
        stderr = (stderr + d.toString()).slice(-6000);
      });
      child.stdout.on('data', (d) => {
        buffer += d.toString();
        if (buffer.length > 2_000_000) {
          abort();
          finish(new Error('Codex 输出超过限制'));
          return;
        }
        let n;
        while ((n = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          try {
            const e = JSON.parse(line);
            if (e.type === 'thread.started' || e.type === 'turn.started') onProgress('Codex 正在阅读与整理');
            if (e.item?.type === 'web_search') onProgress('正在联网查找资料');
            if (e.type === 'item.completed' && e.item?.type === 'agent_message')
              lastMessage = e.item.text || '';
            if (e.type === 'error') stderr = String(e.message || 'Codex 执行失败');
          } catch {}
        }
      });
      child.on('close', (code) => {
        if (signal?.aborted) return finish(codexAbortError(signal));
        if (code !== 0) {
          const message = stderr.replace(/(?:sk-|Bearer\s+)\S+/gi, '[redacted]').slice(-900);
          return finish(
            new Error(`Codex 未完成（${code}）：${message || '请检查 codex login status 和额度'}`),
          );
        }
        finish(null, lastMessage);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
    let raw;
    try {
      raw = await readFile(outputFile, 'utf8');
    } catch {
      raw = result;
    }
    if (!raw?.trim()) throw new Error('Codex 未返回学习内容');
    return raw;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
