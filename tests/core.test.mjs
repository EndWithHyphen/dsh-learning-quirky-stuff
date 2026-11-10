import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../core.js';
const scene = {
  elements: [
    {
      id: 'handwritten',
      type: 'freedraw',
      x: 10,
      y: 20,
      points: [
        [0, 0],
        [20, 30],
      ],
      version: 1,
    },
  ],
  files: {},
  appState: { viewBackgroundColor: '#ffffff' },
};
async function library() {
  return new LibraryStore(await mkdtemp(join(tmpdir(), 'studyboard-test-'))).init();
}
test('分类为空起步，用户创建层级；重启后分类及笔迹仍存在', async () => {
  const s = await library();
  assert.deepEqual((await s.library()).folders, []);
  const a = await s.editFolder({ name: '我的自定义分类', parentId: null });
  const b = await s.editFolder({ name: '子分类', parentId: a.id });
  const n = await s.create({ title: '第一篇', folderId: b.id, tags: ['复习', '复习', '想法'] });
  await s.save({ id: n.id, baseRevision: 0, scene });
  const reopened = await new LibraryStore(s.root).init(),
    stored = await reopened.read(n.id);
  assert.equal(stored.scene.elements[0].points[1][1], 30);
  assert.deepEqual(stored.tags, ['复习', '想法']);
  assert.equal(stored.folderId, b.id);
  assert.equal((await reopened.library()).folders.length, 2);
});
test('分类环、同级重复名称和非空分类删除均不破坏数据', async () => {
  const s = await library(),
    a = await s.editFolder({ name: 'A' }),
    b = await s.editFolder({ name: 'B', parentId: a.id });
  await assert.rejects(s.editFolder({ id: a.id, name: 'A', parentId: b.id }), /子分类/);
  await assert.rejects(s.editFolder({ name: 'B', parentId: a.id }), /已有/);
  await assert.rejects(s.deleteFolder({ id: a.id }), /移走/);
  assert.equal(s.folders.find((f) => f.id === a.id).parentId, null);
});
test('回收站笔记不阻止删除空分类；内容保留，重启恢复到未分类', async () => {
  const s = await library(),
    folder = await s.editFolder({ name: '待删除分类' }),
    board = await s.create({ title: '保留内容', folderId: folder.id, tags: ['案例'] });
  await s.save({ id: board.id, baseRevision: 0, scene });
  await s.addSummary(board.id, {
    text: '保留这份总结',
    annotations: [{ id: 'annotation', note: '保留这条备注' }],
  });
  await assert.rejects(s.deleteFolder({ id: folder.id }), /1 篇未删除/);
  assert.equal((await s.read(board.id)).folderId, folder.id);
  await s.metadata({ id: board.id, deleted: true });
  const before = await s.read(board.id);
  assert.deepEqual(await s.deleteFolder({ id: folder.id }), { deleted: true, releasedTrashNotes: 1 });
  const reopened = await new LibraryStore(s.root).init();
  assert.equal(reopened.folders.length, 0);
  assert.deepEqual(await reopened.read(board.id), { ...before, folderId: null });
  await reopened.metadata({ id: board.id, deleted: false });
  const restored = await reopened.read(board.id);
  assert.equal(restored.folderId, null);
  assert.equal(restored.deletedAt, null);
  assert.deepEqual(restored.scene, scene);
  assert.deepEqual(restored.summaries, before.summaries);
  assert.deepEqual(restored.tags, ['案例']);
});
test('并行保存拒绝过期版本；之前的完整文件留有备份', async () => {
  const s = await library(),
    b = await s.create({ title: '并发' });
  const saves = await Promise.allSettled([
    s.save({ id: b.id, baseRevision: 0, scene }),
    s.save({ id: b.id, baseRevision: 0, scene: { ...scene, elements: [] } }),
  ]);
  assert.equal(saves.filter((v) => v.status === 'fulfilled').length, 1);
  assert.equal((await s.read(b.id)).revision, 1);
  assert.equal(JSON.parse(await readFile(s.boardPath(b.id) + '.bak', 'utf8')).revision, 0);
});
test('图片缺失与路径穿越均被拒绝；保存中的标签修改不丢失', async () => {
  const s = await library(),
    b = await s.create({ title: '图片' });
  await assert.rejects(s.read('../folders'), /无效/);
  await assert.rejects(
    s.save({
      id: b.id,
      baseRevision: 0,
      scene: { elements: [{ id: 'pic', type: 'image', x: 0, y: 0, fileId: 'missing' }], files: {} },
    }),
    /图片/,
  );
  await Promise.all([
    s.save({ id: b.id, baseRevision: 0, scene }),
    s.metadata({ id: b.id, tags: ['新标签'] }),
  ]);
  assert.deepEqual((await s.read(b.id)).tags, ['新标签']);
  assert.equal((await s.read(b.id)).scene.elements.length, 1);
});
test('回收站可恢复，恢复后仍含原笔迹、图片与总结', async () => {
  const s = await library(),
    b = await s.create({ title: '保留' });
  await s.save({ id: b.id, baseRevision: 0, scene });
  await s.addSummary(b.id, { text: '测试总结', sourceRevision: 1 });
  await s.metadata({ id: b.id, deleted: true });
  await assert.rejects(s.save({ id: b.id, baseRevision: 1, scene }), /回收站/);
  await s.metadata({ id: b.id, deleted: false });
  const result = await s.read(b.id);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.scene.elements.length, 1);
});
test('损坏数据不会被静默覆盖，备份包含完整可编辑内容', async () => {
  const s = await library(),
    b = await s.create({ title: '可备份' });
  await s.save({ id: b.id, baseRevision: 0, scene });
  assert.deepEqual((await s.backup()).boards[0].scene, scene);
  await writeFile(s.boardPath(b.id), 'not-json');
  assert.deepEqual((await s.library()).errors, [b.id + '.json']);
  await assert.rejects(s.save({ id: b.id, baseRevision: 1, scene }));
  assert.equal(await readFile(s.boardPath(b.id), 'utf8'), 'not-json');
});
