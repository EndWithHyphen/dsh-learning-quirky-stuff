import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodex, codexAbortError } from '../codex-provider.js';
test('Codex 超时保留真实原因，主动取消才显示取消', async () => {
  const manual = new AbortController();
  manual.abort();
  assert.equal(codexAbortError(manual.signal).message, '已取消 Codex 任务');
  const dir = await mkdtemp(join(tmpdir(), 'codex-abort-')),
    bin = join(dir, 'fake-codex');
  await writeFile(
    bin,
    "#!/usr/bin/env node\nprocess.on('SIGTERM',()=>process.exit(0));console.log(JSON.stringify({type:'thread.started'}));setInterval(()=>{},1000);\n",
  );
  await chmod(bin, 0o700);
  const controller = new AbortController(),
    reason = Object.assign(new Error('总结超时测试'), { code: 'SUMMARY_TIMEOUT' });
  await assert.rejects(
    runCodex({
      prompt: 'fixture',
      model: 'test-model',
      reasoningEffort: 'low',
      schema: { type: 'object' },
      bin,
      signal: controller.signal,
      onProgress: () => controller.abort(reason),
    }),
    (e) => e.message === '总结超时测试' && e.code === 'SUMMARY_TIMEOUT',
  );
});
