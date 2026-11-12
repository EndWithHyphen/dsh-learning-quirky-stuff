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

test('同 URL 再次打开复用已有笔记，并发新标签页不会重复创建', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-url-reuse-')),
    store = await new LibraryStore(join(root, 'data')).init(),
    server = new CaptureServer(store, { port: 0 });
  await server.start();
  t.after(() => server.close());
  const url = 'https://example.com/article?id=123';
  const first = await server.capture({ requestId: 'same-url-first', url, title: '原笔记', reuse: true });
  await store.dispatch({
    action: 'saveWebNotes',
    id: first.id,
    url,
    text: '保留已有的学习记录',
    baseVersion: 0,
  });
  const results = await Promise.all(
    [1, 2, 3].map((i) =>
      server.capture({ requestId: 'same-url-new-tab-' + i, url, title: '重开的网页', reuse: true }),
    ),
  );
  assert.ok(results.every((r) => r.id === first.id && r.reused));
  assert.equal((await store.all()).boards.length, 1);
  assert.equal((await store.read(first.id)).webNotes.text, '保留已有的学习记录');
  const other = await server.capture({
    requestId: 'other-url-first',
    url: 'https://example.com/article?id=124',
    reuse: true,
  });
  assert.notEqual(other.id, first.id, 'Different content query parameters keep independent notes');
  const oldChoice = await store.create({ title: '这个标签页原来选择的笔记', source: { url, title: '原文' } });
  assert.equal(
    (await server.capture({ requestId: 'same-url-bound-choice', url, reuseId: oldChoice.id, reuse: true }))
      .id,
    oldChoice.id,
  );
  await store.metadata({ id: oldChoice.id, deleted: true });
  assert.equal(
    (await server.capture({ requestId: 'same-url-after-trash', url, reuse: true })).id,
    first.id,
    'Trashed duplicates cannot replace a live note',
  );
  const emptyUrl = 'https://example.com/new';
  const concurrent = await Promise.all(
    [1, 2, 3].map((i) => server.capture({ requestId: 'new-url-parallel-' + i, url: emptyUrl, reuse: true })),
  );
  assert.equal(new Set(concurrent.map((r) => r.id)).size, 1);
  assert.equal(concurrent.filter((r) => !r.reused).length, 1);
});
