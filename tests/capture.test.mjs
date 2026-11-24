import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { CaptureServer } from '../capture-server.js';
import { LearningStore } from '../learning.js';
import { canvasQuotes } from '../shared/canvas-quotes.js';
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

test('网页划词按原文进入绑定画布和间隔复习，重试不会复制或复活卡片', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-web-quote-'));
  const store = await new LibraryStore(join(root, 'data')).init();
  const learning = await new LearningStore(store).init();
  const server = new CaptureServer(store, { port: 0 });
  await server.start();
  t.after(() => server.close());
  const origin = 'chrome-extension://' + 'b'.repeat(32),
    secret = 'd'.repeat(64);
  const pairing = server.connections.start(origin, { protocol: 2, secret });
  await server.connections.approve(pairing.id);
  const { token } = server.connections.poll(origin, { id: pairing.id, secret });
  const headers = { 'content-type': 'application/json', Authorization: 'Bearer ' + token, Origin: origin };
  const url = 'https://example.test/article?part=3',
    sourceUrl = 'https://reader.example.test/passage#four';
  const request = {
    requestId: 'selection-test-first',
    url,
    title: '原文标题',
    sourceUrl,
    text: '  学而时习之。\r\n\n\tRead  it again.  ',
  };
  const post = (body, options = headers, path = '/capture/quote') =>
    fetch('http://127.0.0.1:' + server.port + path, {
      method: 'POST',
      headers: options,
      body: JSON.stringify(body),
    });
  assert.equal((await post(request, { ...headers, Authorization: '' })).status, 401);
  assert.equal((await post(request, { ...headers, Origin: 'https://example.test' })).status, 403);
  for (const changes of [
    { text: ' \t\n' },
    { text: '字'.repeat(6001) },
    { sourceUrl: 'file:///temp' },
    { url: 'about:blank' },
  ])
    assert.equal((await post({ ...request, ...changes })).status, 400);
  assert.equal((await store.all()).boards.length, 0);
  const initial = await post(request);
  assert.equal(initial.status, 200);
  const saved = await initial.json();
  const board = await store.read(saved.id);
  assert.equal(board.source.url, url);
  assert.equal(board.scene.elements.find((e) => e.id === saved.quoteId).link, sourceUrl);
  assert.deepEqual(canvasQuotes(board.scene.elements), [
    { id: saved.quoteId, text: request.text, source: request.title },
  ]);
  assert.equal(
    (await learning.dashboard()).cards.find((c) => c.quoteElementId === saved.quoteId).answer,
    request.text,
  );
  await store.dispatch({ action: 'saveWebNotes', id: board.id, url, baseVersion: 0, text: '已有随手记' });
  const before = await store.read(board.id);
  const ink = { id: 'existing-ink', type: 'freedraw', x: 4, y: 520, height: 50 };
  await store.save({
    id: board.id,
    baseRevision: before.revision,
    scene: { ...before.scene, elements: [...before.scene.elements, ink] },
  });
  const other = await store.create({ title: '同一网页的另一篇笔记', source: { url } });
  const extra = { ...request, requestId: 'selection-test-second', text: '下一段。\n', reuseId: board.id };
  const responses = await Promise.all([post(extra), post(request), post(extra)]);
  for (const response of responses) assert.equal(response.status, 200);
  const [second, replay, duplicate] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(second.id, board.id);
  assert.equal(second.quoteId, duplicate.quoteId);
  assert.equal(replay.quoteId, saved.quoteId);
  assert.equal((await store.read(other.id)).scene.elements.length, 0);
  assert.equal(
    (await post({ ...extra, url: 'https://other.test/', requestId: 'selection-wrong-board' })).status,
    400,
  );
  const after = await store.read(board.id);
  assert.equal(after.webNotes.text, '已有随手记');
  assert.deepEqual(
    after.scene.elements.find((e) => e.id === ink.id),
    ink,
  );
  assert.ok(after.scene.elements.find((e) => e.id === second.quoteId).y > ink.y + ink.height);
  assert.equal(canvasQuotes(after.scene.elements).length, 2);
  await assert.rejects(
    store.save({ id: board.id, baseRevision: before.revision, scene: before.scene }),
    /另一个窗口/,
  );
  const elements = after.scene.elements.filter((e) => e.customData?.studyboard?.widgetId !== saved.quoteId);
  const edited = await store.save({
    id: board.id,
    baseRevision: after.revision,
    scene: { ...after.scene, elements },
  });
  assert.equal((await (await post(request)).json()).revision, edited.revision);
  assert.deepEqual(
    (await learning.dashboard()).cards.map((c) => c.answer),
    [extra.text],
  );
  const ordinary = { ...request, requestId: 'a-plain-excerpt', reuseId: board.id };
  const excerpt = await (await post(ordinary, headers, '/capture/excerpt')).json();
  assert.equal(excerpt.ok, true);
  assert.equal(excerpt.quoteId, undefined);
  const plain = (await store.read(board.id)).scene.elements.find((e) => e.id === excerpt.elementId);
  assert.equal(plain.type, 'text');
  assert.equal(plain.originalText, request.text);
  assert.equal(plain.link, sourceUrl);
  assert.equal(plain.customData.studyboard.webSource.title, request.title);
  assert.equal((await (await post(ordinary, headers, '/capture/excerpt')).json()).revision, excerpt.revision);
  assert.equal((await post(ordinary)).status, 400);
  assert.deepEqual(
    (await learning.dashboard()).cards.map((c) => c.answer),
    [extra.text],
  );
});
