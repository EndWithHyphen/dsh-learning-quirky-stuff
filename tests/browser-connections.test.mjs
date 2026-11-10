import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CaptureServer } from '../capture-server.js';
import { LibraryStore } from '../core.js';
const origin = 'chrome-extension://' + 'a'.repeat(32),
  other = 'chrome-extension://' + 'b'.repeat(32),
  secret = 'c'.repeat(64);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'study-pair-')),
    store = await new LibraryStore(root).init(),
    server = new CaptureServer(store, { port: 0 });
  await server.start();
  t.after(() => server.close());
  const post = async (path, body = {}, from = origin, token) => {
    const r = await fetch('http://127.0.0.1:' + server.port + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(from ? { Origin: from } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, value: await r.json().catch(() => null) };
  };
  return { root, server, post };
}
test('浏览器连接必须由 DSH 确认，令牌只交给原扩展及原请求，撤销后立即失效', async (t) => {
  const { server, post, root } = await fixture(t);
  assert.equal((await post('/pair/start', { protocol: 2, secret }, 'https://example.test')).status, 403);
  assert.equal((await post('/pair/start', { protocol: 2, secret }, null)).status, 403);
  assert.equal((await post('/pair/start', { protocol: 99, secret })).status, 400);
  const start = await post('/pair/start', { protocol: 2, secret });
  assert.equal(start.value.status, 'pending');
  assert.equal('token' in start.value, false);
  assert.equal((await post('/pair/poll', { id: start.value.id, secret })).value.status, 'pending');
  assert.equal((await post('/pair/poll', { id: start.value.id, secret }, other)).status, 400);
  assert.equal((await post('/pair/poll', { id: start.value.id, secret: 'd'.repeat(64) })).status, 400);
  assert.equal(JSON.stringify(server.info()).includes(secret), false);
  assert.equal(JSON.stringify(server.info()).includes(server.config.token), false);
  await server.connections.approve(start.value.id);
  const approved = (await post('/pair/poll', { id: start.value.id, secret })).value;
  assert.equal(approved.status, 'approved');
  assert.match(approved.token, /^[a-f0-9]{64}$/);
  assert.equal((await post('/verify', {}, origin, approved.token)).status, 200);
  assert.equal((await post('/verify', {}, other, approved.token)).status, 401);
  assert.equal((await post('/verify', {}, origin, server.config.token)).status, 401);
  const saved = JSON.parse(await readFile(join(root, 'capture.json')));
  assert.equal(saved.clients[0].extensionId, 'a'.repeat(32));
  await server.connections.revoke(approved.clientId);
  assert.equal((await post('/verify', {}, origin, approved.token)).status, 401);
});
test('连接请求过期、拒绝及协议不兼容可恢复，不把未确认请求存成授权', async (t) => {
  const { server, post } = await fixture(t);
  let now = Date.now();
  server.connections.now = () => now;
  const start = server.connections.start(origin, { protocol: 2, secret });
  server.connections.reject(start.id);
  assert.equal(server.connections.poll(origin, { id: start.id, secret }).status, 'rejected');
  now += 130000;
  assert.throws(() => server.connections.poll(origin, { id: start.id, secret }), /过期/);
  assert.deepEqual(server.info().pending, []);
  assert.equal(server.config.clients.length, 0);
  const response = await fetch('http://127.0.0.1:' + server.port + '/verify', {
    method: 'POST',
    headers: { 'X-Studyboard-Protocol': '99' },
  });
  assert.equal(response.status, 426);
});
test('旧版已建立的连接可迁移，升级后不再写入扩展安装目录', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-legacy-pair-')),
    store = await new LibraryStore(root).init(),
    token = 'd'.repeat(64);
  await writeFile(join(root, 'capture.json'), JSON.stringify({ token, requests: {} }));
  const server = new CaptureServer(store, { port: 0, extensionDir: join(root, 'extension') });
  await server.start();
  t.after(() => server.close());
  const migrated = await server.connections.migrate({
    headers: { origin, authorization: 'Bearer ' + token },
  });
  assert.notEqual(migrated.token, token);
  assert.equal(server.config.legacyTokenAllowed, false);
  assert.equal(
    server.connections.authorized({ headers: { origin, authorization: 'Bearer ' + migrated.token } }),
    true,
  );
  await assert.rejects(readFile(join(root, 'extension', 'connection.json')), { code: 'ENOENT' });
});

test('保存连接失败时不保留半完成授权，用户可以重试确认', async (t) => {
  const { server, root } = await fixture(t);
  const start = server.connections.start(origin, { protocol: 2, secret });
  await writeFile(join(root, 'not-a-folder'), 'test');
  const original = server.file;
  server.file = join(root, 'not-a-folder', 'capture.json');
  await assert.rejects(server.connections.approve(start.id));
  assert.equal(server.config.clients.length, 0);
  assert.equal(server.connections.poll(origin, { id: start.id, secret }).status, 'pending');
  server.file = original;
  await server.connections.approve(start.id);
  assert.equal(server.connections.poll(origin, { id: start.id, secret }).status, 'approved');
});
