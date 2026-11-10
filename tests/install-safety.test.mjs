import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockDataDirectory } from '../server/data-lock.js';
import { NativeReader } from '../server/integrations/native-reader.js';
import { normalizeConfig } from '../plugin-config.js';
test('同一数据目录只允许一个服务写入，释放后可重新加载', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-lock-')),
    release = await lockDataDirectory(root);
  try {
    await assert.rejects(lockDataDirectory(root), /另一个 DSH/);
  } finally {
    await release();
  }
  const again = await lockDataDirectory(root);
  await again();
});
test('不支持的本机平台给出明确能力状态；配置拒绝无效端口', async () => {
  const reader = new NativeReader(tmpdir(), { platform: 'win32' });
  assert.equal((await reader.availability()).available, false);
  await assert.rejects(reader.binary(), /macOS/);
  assert.equal(normalizeConfig().capturePort, 43127);
  assert.throws(() => normalizeConfig({ capturePort: -1 }), /端口/);
  assert.throws(() => normalizeConfig({ captureEnabled: 'yes' }), /布尔/);
});
