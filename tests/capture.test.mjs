import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { CaptureServer } from '../capture-server.js';
test('Chrome 绑定后访问；限定本机且不接受普通网页伪造', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-capture-')),
    store = await new LibraryStore(join(root, 'data')).init(),
    server = new CaptureServer(store, { port: 0, extensionDir: join(root, 'extension') });
  await server.start();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`,
    headers = {
      'content-type': 'application/json',
      Authorization: '',
      Origin: 'chrome-extension://' + 'a'.repeat(32),
    };
  const origin = headers.Origin,
    secret = 'c'.repeat(64);
  const pending = server.connections.start(origin, { protocol: 2, secret });
  await server.connections.approve(pending.id);
  const connection = server.connections.poll(origin, { id: pending.id, secret });
  headers.Authorization = 'Bearer ' + connection.token;
  await assert.rejects(readFile(join(root, 'extension/connection.json')), { code: 'ENOENT' });
  assert.equal('pairingCode' in server.info(), false);
  const body = JSON.stringify({
    requestId: 'capture-test-01',
    title: '学习网页',
    url: 'https://example.com/lesson',
  });
  assert.equal(
    (
      await fetch(base + '/capture', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + '/capture', {
        method: 'POST',
        body,
        headers: { ...headers, Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  const results = await Promise.all(
    [1, 2].map(() => fetch(base + '/capture', { method: 'POST', headers, body }).then((r) => r.json())),
  );
  assert.equal(results[0].id, results[1].id);
  const notes = await store.all();
  assert.equal(notes.boards.length, 1);
  assert.equal(notes.boards[0].scene.elements.length, 0);
  assert.equal(notes.boards[0].source.url, 'https://example.com/lesson');
  const invalid = await fetch(base + '/capture', {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'capture-test-02', title: 'bad', url: 'javascript:alert(1)' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await store.all()).boards.length, 1);
});
