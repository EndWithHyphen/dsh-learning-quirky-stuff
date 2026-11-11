import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelGateway } from '../server/ai/gateway.js';
import { codexArgs } from '../codex-provider.js';

test('Codex 普通文本调用不写空 schema，图片和 JSON 结果仍经实际进程协议传递', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-codex-text-')),
    bin = join(dir, 'codex-fixture');
  const old = process.env.STUDYBOARD_CODEX_BIN;
  t.after(async () => {
    if (old === undefined) delete process.env.STUDYBOARD_CODEX_BIN;
    else process.env.STUDYBOARD_CODEX_BIN = old;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', text => prompt += text);
process.stdin.on('end', () => {
  const schemaIndex = args.indexOf('--output-schema');
  const imageIndex = args.indexOf('--image');
  if (imageIndex >= 0 && !fs.readFileSync(args[imageIndex + 1]).length) throw new Error('missing image');
  let answer = '可以从竞争解释和证据边界继续追问。';
  if (schemaIndex >= 0) {
    const schema = JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8'));
    if (!schema.properties.answer) throw new Error('schema was not transferred');
    answer = JSON.stringify({answer: '结构化结果'});
  }
  if (!prompt.includes('测试提问')) throw new Error('missing prompt');
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], answer);
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:answer}}));
});
`,
  );
  await chmod(bin, 0o700);
  process.env.STUDYBOARD_CODEX_BIN = bin;
  const gateway = new ModelGateway({}),
    options = {
      prompt: '测试提问',
      modelInfo: { provider: 'codex-local', id: 'fixture', name: '测试模型', vision: true },
      signal: AbortSignal.timeout(10000),
    };
  const plain = await gateway.text(options);
  assert.match(plain.text, /竞争解释/);
  const illustrated = await gateway.text({
    ...options,
    images: [{ mimeType: 'image/png', data: Buffer.from('fixture-image').toString('base64') }],
  });
  assert.equal(illustrated.text, plain.text);
  const json = await gateway.json({
    ...options,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  });
  assert.deepEqual(json.value, { answer: '结构化结果' });
  assert.equal(codexArgs('/tmp', null, '/tmp/out', [], 'fixture').includes('--output-schema'), false);
});
