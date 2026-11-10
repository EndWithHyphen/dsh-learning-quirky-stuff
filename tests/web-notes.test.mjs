import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../core.js';
import { CaptureServer } from '../capture-server.js';
import { buildSummaryPrompt } from '../model.js';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';
import { parseStudy } from '../study-schema.js';
import { studyFixture } from './fixture.mjs';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
test('网页随手记独立保存，冲突保留双方内容，重复提交不增加版本', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'web-notes-'))).init(),
    b = await store.create({ title: '文章', source: { url: 'https://example.com/a' } });
  const r = { id: b.id, url: b.source.url, baseVersion: 0, text: '一边阅读，一边记录。' };
  const result = await store.dispatch({ ...r, action: 'saveWebNotes' });
  assert.equal(result.webNotes.version, 1);
  assert.equal((await store.dispatch({ ...r, action: 'saveWebNotes' })).webNotes.version, 1);
  await assert.rejects(
    store.dispatch({ ...r, action: 'saveWebNotes', text: '另一窗口草稿' }),
    (e) => e.code === 'NOTE_CONFLICT' && e.latest.text === r.text,
  );
  const note = await store.dispatch({ action: 'webNote', id: b.id, url: b.source.url });
  assert.equal(note.webNotes.text, r.text);
  assert.equal(isRemoteJsonValue(note), true);
});
test('截图进入同一笔记白板，保留已有内容、来源和视频时间，重试不重复', async () => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'web-images-'))).init(),
    b = await store.create({ source: { url: 'https://example.com/video' } });
  await store.save({
    id: b.id,
    baseRevision: 0,
    scene: {
      elements: [{ id: 'ink', type: 'freedraw', x: 0, y: 0, width: 20, height: 30 }],
      files: {},
      appState: {},
    },
  });
  const r = {
    action: 'addWebImage',
    id: b.id,
    url: b.source.url,
    requestId: 'screenshot-one',
    dataURL: png,
    width: 1,
    height: 1,
    preview: png,
    caption: '区域截图',
    videoTime: 125,
  };
  const first = await store.dispatch(r),
    second = await store.dispatch(r);
  assert.equal(first.image.id, second.image.id);
  assert.equal(second.duplicate, true);
  const saved = await store.read(b.id);
  assert.equal(saved.scene.elements.length, 2);
  assert.equal(saved.scene.elements[1].type, 'image');
  assert.ok(saved.scene.files[saved.scene.elements[1].fileId]);
  assert.equal(saved.webImages[0].videoTime, 125);
  assert.equal(saved.revision, 2);
  await assert.rejects(
    store.dispatch({ ...r, requestId: 'wrong-page', url: 'https://example.com/other' }),
    /来源不一致/,
  );
});
test('浏览器重复快捷键打开同页已有笔记，HTTP 文字保存及截图贯通', async (t) => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'web-api-'))).init(),
    server = new CaptureServer(store, { port: 0 });
  await server.start();
  t.after(() => server.close());
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${server.config.token}`,
    Origin: 'chrome-extension://' + 'a'.repeat(32),
  };
  const pairing = server.connections.start(headers.Origin, { protocol: 2, secret: 'e'.repeat(64) });
  await server.connections.approve(pairing.id);
  headers.Authorization =
    'Bearer ' + server.connections.poll(headers.Origin, { id: pairing.id, secret: 'e'.repeat(64) }).token;
  const send = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const a = await send('/capture', {
      requestId: 'request-first',
      title: '课程',
      url: 'https://example.com/course',
      reuse: true,
    }),
    b = await send('/capture', {
      requestId: 'request-second',
      title: '课程',
      url: 'https://example.com/course',
      reuse: true,
    });
  assert.equal(a.id, b.id);
  assert.equal(b.reused, true);
  const note = { id: a.id, url: a.url };
  assert.equal((await send('/note/save', { ...note, text: '课堂随手记', baseVersion: 0 })).status, 200);
  assert.equal((await send('/note/save', { ...note, text: '旧版本修改', baseVersion: 0 })).status, 409);
  assert.equal(
    (
      await send('/note/image', {
        ...note,
        requestId: 'image-req-1',
        dataURL: png,
        width: 1,
        height: 1,
        preview: png,
      })
    ).status,
    200,
  );
  const view = await send('/note/get', note);
  assert.equal(view.webNotes.text, '课堂随手记');
  assert.equal(view.images.length, 1);
  assert.equal((await store.all()).boards.length, 1);
});
test('学习提示词纳入随手记，要求就地纠错，题量由知识点决定', () => {
  const prompt = buildSummaryPrompt(
    { title: '课程', webNotes: { text: '平面三角形内角和是360度。' } },
    { elements: [], scope: 'board' },
  );
  assert.match(prompt, /平面三角形/);
  assert.match(prompt, /原说法、修正与理由/);
  assert.match(prompt, /不设固定题数/);
  assert.doesNotMatch(prompt, /questions 给 3～6/);
  const data = structuredClone(studyFixture);
  data.questions = Array.from({ length: 15 }, (_, i) => ({ ...data.questions[0], id: 'q' + i }));
  assert.equal(parseStudy(data).questions.length, 8);
});
test('删除截图只移除对应图片，保留笔迹；重开后仍能恢复原图与位置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-delete-')),
    store = await new LibraryStore(root).init(),
    b = await store.create({ source: { url: 'https://example.com/video' } });
  const context = { id: b.id, url: b.source.url };
  await store.save({
    id: b.id,
    baseRevision: 0,
    scene: {
      elements: [{ id: 'ink', type: 'freedraw', x: 10, y: 20, width: 50, height: 30 }],
      appState: {},
      files: {},
    },
  });
  const { image } = await store.dispatch({
    ...context,
    action: 'addWebImage',
    requestId: 'delete-fixture',
    dataURL: png,
    preview: png,
    width: 1,
    height: 1,
  });
  const before = (await store.read(b.id)).scene.elements.find((e) => e.id === image.id);
  const deleted = await store.dispatch({
    ...context,
    action: 'setWebImageDeleted',
    imageId: image.id,
    deleted: true,
  });
  assert.equal(deleted.images.length, 0);
  assert.equal(deleted.deletedImages.length, 1);
  assert.equal(
    (await store.dispatch({ ...context, action: 'setWebImageDeleted', imageId: image.id, deleted: true }))
      .revision,
    deleted.revision,
  );
  // Excalidraw may omit old tombstones/files; the screenshot's recovery copy must survive.
  await store.save({
    id: b.id,
    baseRevision: deleted.revision,
    scene: {
      elements: [{ id: 'ink', type: 'freedraw', x: 10, y: 20, width: 50, height: 30 }],
      appState: {},
      files: {},
    },
  });
  const reopened = await new LibraryStore(root).init();
  const restored = await reopened.dispatch({
    ...context,
    action: 'setWebImageDeleted',
    imageId: image.id,
    deleted: false,
  });
  assert.equal(restored.images.length, 1);
  assert.equal(restored.deletedImages.length, 0);
  const saved = await reopened.read(b.id),
    after = saved.scene.elements.find((e) => e.id === image.id);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.fileId, before.fileId);
  assert.equal(saved.scene.files[image.fileId].dataURL, png);
  assert.ok(saved.scene.elements.some((e) => e.id === 'ink'));
});
test('画布 HTTP 保存与 DSH 共用笔迹，拒绝旧版本覆盖截图，重试幂等', async (t) => {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'web-canvas-'))).init(),
    server = new CaptureServer(store, { port: 0 });
  await server.start();
  t.after(() => server.close());
  const b = await store.create({ source: { url: 'https://example.com/canvas' } }),
    context = { id: b.id, url: b.source.url };
  const send = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${server.config.token}` },
      body: JSON.stringify({ ...context, ...body }),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const scene = {
    elements: [
      {
        id: 'stroke',
        type: 'freedraw',
        x: 1,
        y: 2,
        width: 15,
        height: 20,
        points: [
          [0, 0],
          [15, 20],
        ],
      },
    ],
    files: {},
    appState: { viewBackgroundColor: '#fff' },
  };
  const payload = { scene, baseRevision: 0, requestId: 'canvas-save-one' };
  assert.equal((await send('/note/canvas/save', payload)).revision, 1);
  assert.equal((await send('/note/canvas/save', payload)).revision, 1);
  const image = await send('/note/image', { requestId: 'canvas-image', dataURL: png, width: 1, height: 1 });
  assert.equal(image.status, 200);
  const conflict = await send('/note/canvas/save', {
    ...payload,
    requestId: 'canvas-save-two',
    baseRevision: 1,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'CANVAS_CONFLICT');
  let r = await send('/note/canvas/get', {});
  assert.equal(r.scene.elements.length, 2);
  assert.equal(r.scene.elements[0].type, 'freedraw');
  r.scene.elements[1].isDeleted = true;
  const saved = await send('/note/canvas/save', {
    scene: r.scene,
    baseRevision: r.revision,
    requestId: 'canvas-delete-image',
  });
  assert.equal(saved.images.length, 0);
  assert.equal(saved.deletedImages.length, 1);
  assert.equal((await send('/note/image/restore', { imageId: image.image.id })).images.length, 1);
  assert.equal((await send('/note/image/delete', { imageId: image.image.id })).images.length, 0);
  assert.equal((await send('/note/canvas/get', { url: 'https://example.com/wrong' })).status, 400);
});

test('截图备注随图片删除和恢复，重启后保留完整备注及布局', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-image-note-')),
    store = await new LibraryStore(root).init(),
    b = await store.create({ source: { url: 'https://example.com/note' } }),
    context = { id: b.id, url: b.source.url };
  const { image } = await store.dispatch({
    ...context,
    action: 'addWebImage',
    requestId: 'image-notes-001',
    dataURL: png,
    preview: png,
    width: 1,
    height: 1,
  });
  const current = await store.read(b.id),
    scene = current.scene;
  scene.elements[0].customData = { studyboard: { imageNote: '图中的结论依赖于这个前提' } };
  scene.elements.push({
    id: 'image-note-text',
    type: 'text',
    x: 0,
    y: 50,
    width: 250,
    height: 40,
    text: '图中的结论依赖于这个前提',
    customData: { studyboard: { imageNoteFor: image.id } },
  });
  scene.elements.push({
    id: 'image-ocr-text',
    type: 'text',
    x: 0,
    y: 110,
    width: 300,
    height: 50,
    text: '核对后的图片文字',
    customData: { studyboard: { imageTextFor: image.id } },
  });
  await store.save({ id: b.id, baseRevision: current.revision, scene });
  assert.equal(
    (await store.dispatch({ ...context, action: 'webNote' })).images[0].note,
    '图中的结论依赖于这个前提',
  );
  const deleted = await store.dispatch({
    ...context,
    action: 'setWebImageDeleted',
    imageId: image.id,
    deleted: true,
  });
  assert.ok((await store.read(b.id)).scene.elements.every((e) => e.isDeleted));
  await store.save({
    id: b.id,
    baseRevision: deleted.revision,
    scene: { elements: [], appState: {}, files: {} },
  });
  const reopened = await new LibraryStore(root).init();
  await reopened.dispatch({ ...context, action: 'setWebImageDeleted', imageId: image.id, deleted: false });
  const restored = await reopened.read(b.id);
  assert.equal(restored.scene.elements.filter((e) => !e.isDeleted).length, 3);
  assert.equal(restored.scene.elements.find((e) => e.id === 'image-ocr-text').text, '核对后的图片文字');
  assert.equal(
    restored.scene.elements.find((e) => e.id === 'image-note-text').text,
    '图中的结论依赖于这个前提',
  );
  assert.match(
    buildSummaryPrompt(restored, {
      elements: [restored.scene.elements.find((e) => e.id === image.id)],
      scope: 'selection',
    }),
    /图中的结论依赖于这个前提/,
  );
});
