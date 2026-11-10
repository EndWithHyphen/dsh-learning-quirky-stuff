import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasSession } from '../src/chrome-canvas-session.js';
const empty = { elements: [], files: {}, appState: {} },
  ink = (n) => ({
    elements: [
      {
        id: 'stroke',
        type: 'freedraw',
        x: 0,
        y: 0,
        version: n,
        points: [
          [0, 0],
          [n, n],
        ],
      },
    ],
    files: {},
    appState: {},
  });
const drafts = () => {
  const store = new Map();
  return {
    store,
    read: async (key) => structuredClone(store.get(key)),
    put: async (key, value) => store.set(key, structuredClone(value)),
    delete: async (key) => store.delete(key),
  };
};
const context = { id: 'note-id', title: '课程', url: 'https://example.com/lesson' };
test('画布在保存期间继续写字，串行保存新笔迹，完成后才清理本机草稿', async () => {
  const cache = drafts(),
    sent = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const s = new CanvasSession({
    context,
    drafts: cache,
    request: async (path, r) => {
      if (path.endsWith('/get')) return { scene: empty, revision: 0 };
      sent.push(structuredClone(r));
      if (sent.length === 1) await gate;
      return { revision: sent.length, images: [], deletedImages: [] };
    },
  });
  await s.load();
  s.change(ink(1));
  const save = s.flush();
  await new Promise((r) => setTimeout(r, 5));
  s.change(ink(2));
  release();
  await save;
  assert.equal(sent.length, 2);
  assert.equal(sent[1].baseRevision, 1);
  assert.equal(sent[1].scene.elements[0].version, 2);
  assert.equal(s.dirty, false);
  assert.equal(cache.store.size, 0);
  await s.dispose();
});
test('网络丢失保存响应后，保留同一请求编号重试，随后保存新增笔迹', async () => {
  const cache = drafts(),
    sent = [];
  let call = 0;
  const s = new CanvasSession({
    context,
    drafts: cache,
    request: async (path, r) => {
      if (path.endsWith('/get')) return { scene: empty, revision: 0 };
      sent.push(structuredClone(r));
      if (++call === 1) throw new Error('lost response');
      return { revision: call === 2 ? 1 : 2, images: [], deletedImages: [] };
    },
  });
  await s.load();
  s.change(ink(1));
  await assert.rejects(s.flush(), /lost response/);
  s.change(ink(2));
  await s.flush();
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.notEqual(sent[1].requestId, sent[2].requestId);
  assert.equal(sent[2].baseRevision, 1);
  assert.equal(sent[2].scene.elements[0].version, 2);
  await s.dispose();
});
test('画布冲突不覆盖 DSH；重新打开能恢复本机笔迹，另存后原笔记仍在', async () => {
  const cache = drafts();
  await cache.put('chrome:note-id', { scene: ink(7), baseRevision: 1 });
  const calls = [];
  const s = new CanvasSession({
    context,
    drafts: cache,
    request: async (path, r) => {
      calls.push({ path, r });
      if (path.endsWith('/get')) return { scene: ink(8), revision: 2 };
      if (path === '/capture') return { id: 'copy-id', title: '副本' };
      return { revision: 1 };
    },
  });
  assert.equal((await s.load()).elements[0].version, 7);
  assert.equal(s.conflict, true);
  await assert.rejects(s.flush(), /版本冲突/);
  assert.equal(calls.length, 1);
  await s.saveCopy();
  assert.equal(calls.at(-1).r.id, 'copy-id');
  assert.equal(calls.at(-1).r.scene.elements[0].version, 7);
  await s.useRemote();
  assert.equal(s.scene.elements[0].version, 8);
  assert.ok([...cache.store.keys()].some((k) => k.startsWith('chrome:note-id:backup:')));
  await s.dispose();
});
test('后台刷新期间新写的笔迹不能被旧响应覆盖', async () => {
  let calls = 0,
    release;
  const s = new CanvasSession({
    context,
    drafts: drafts(),
    request: async () => {
      if (++calls === 1) return { scene: empty, revision: 0 };
      return new Promise((r) => (release = r));
    },
  });
  await s.load();
  const refreshing = s.reload();
  await new Promise((r) => setTimeout(r, 5));
  s.change(ink(3));
  release({ scene: ink(2), revision: 1 });
  assert.equal(await refreshing, null);
  assert.equal(s.scene.elements[0].version, 3);
  assert.equal(s.dirty, true);
  await s.dispose();
});
test('图片未就绪时不发送不完整请求，文件到达后自动使用完整画布保存', async () => {
  const cache = drafts(),
    requests = [],
    states = [];
  const photo = { id: 'photo', type: 'image', fileId: 'file-1', x: 0, y: 0, version: 1 };
  const s = new CanvasSession({
    context,
    drafts: cache,
    onStatus: (kind) => states.push(kind),
    request: async (path, r) => {
      if (path.endsWith('/get')) return { scene: empty, revision: 0 };
      requests.push(r);
      assert.ok(r.scene.files['file-1']);
      return { revision: 1 };
    },
  });
  await s.load();
  s.change({ elements: [photo], files: {}, appState: {} });
  await assert.rejects(s.flush(), (e) => e.code === 'IMAGE_DATA_PENDING');
  assert.equal(requests.length, 0);
  assert.equal(s.blocked, true);
  s.change({
    elements: [photo],
    files: { 'file-1': { id: 'file-1', dataURL: 'data:image/png;base64,AAAA' } },
    appState: {},
  });
  await s.flush();
  assert.equal(requests.length, 1);
  assert.equal(s.dirty, false);
  assert.equal(s.blocked, false);
  assert.equal(states.at(-1), 'saved');
  await s.dispose();
});
test('旧失败快照缺少图片时丢弃该请求，保留并提交草稿中完整的最新内容', async () => {
  const cache = drafts(),
    photo = { id: 'p', type: 'image', fileId: 'f', x: 10, y: 10, version: 1 },
    complete = {
      elements: [photo],
      files: { f: { id: 'f', dataURL: 'data:image/png;base64,AAAA' } },
      appState: {},
    },
    sent = [];
  await cache.put('chrome:note-id', {
    scene: complete,
    baseRevision: 0,
    pending: { requestId: 'old-invalid-request', baseRevision: 0, scene: { ...complete, files: {} } },
  });
  const s = new CanvasSession({
    context,
    drafts: cache,
    request: async (path, r) => {
      if (path.endsWith('/get')) return { scene: empty, revision: 0 };
      sent.push(r);
      return { revision: 1 };
    },
  });
  await s.load();
  assert.equal(s.pending, null);
  await s.flush();
  assert.equal(sent.length, 1);
  assert.notEqual(sent[0].requestId, 'old-invalid-request');
  assert.ok(sent[0].scene.files.f);
  assert.equal(s.dirty, false);
  await s.dispose();
});
test('已恢复到 DSH 的同一内容不会被旧版本元数据误判成冲突', async () => {
  const cache = drafts(),
    local = ink(1),
    remote = ink(1);
  remote.elements[0].version = 8;
  remote.elements[0].updated = 123;
  await cache.put('chrome:note-id', {
    scene: local,
    baseRevision: 0,
    pending: { requestId: 'old', baseRevision: 0, scene: local },
  });
  const s = new CanvasSession({
    context,
    drafts: cache,
    request: async () => ({ scene: remote, revision: 9 }),
  });
  await s.load();
  assert.equal(s.revision, 9);
  assert.equal(s.dirty, false);
  assert.equal(s.conflict, false);
  assert.equal(cache.store.size, 0);
  await s.dispose();
});
