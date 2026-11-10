import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Studyboard from '../index.js';
test('DSH 0.2.2 的真实 Cordis / Remote / Tool 接口，UI 与工具使用同一份数据', async (t) => {
  let tool;
  const ctx = new Context();
  ctx.provide('llm', { listProviders: () => [] });
  ctx.provide('attachments', {});
  ctx.provide('tools', {
    register: (d) => {
      tool = d;
      return () => {};
    },
  });
  const service = new Studyboard(ctx, {
    dataDir: await mkdtemp(join(tmpdir(), 'studyboard-service-')),
    captureEnabled: false,
  });
  t.after(() => service.dispose());
  const direct = await service.execute({ action: 'create', title: '通过界面服务创建' });
  await tool.execute({ request: { action: 'metadata', id: direct.id, tags: ['工具路径'] } });
  assert.deepEqual((await service.execute({ action: 'read', id: direct.id })).tags, ['工具路径']);
  assert.deepEqual(
    remoteMethods(service).map((v) => v.method),
    ['execute', 'models', 'startSummary', 'summaryStatus', 'cancelSummary', 'captureInfo', 'capturePairing'],
  );
});
