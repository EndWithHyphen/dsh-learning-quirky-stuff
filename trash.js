import { readFile, readdir, mkdir, unlink, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite, assertId } from './core.js';
import { legacyStudy, conceptKey } from './study-schema.js';
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 20);
const remove = async (file) => {
  try {
    await unlink(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
};
const entries = async (dir) => {
  try {
    return await readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
};
const load = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};
function conceptIds(boards) {
  return new Set(
    boards.flatMap((b) =>
      b.summaries.flatMap((s) =>
        legacyStudy(s).concepts.map((c) =>
          c.canonicalKey ? hash(conceptKey(c)) : hash(b.id + '/' + s.id + '/' + c.id),
        ),
      ),
    ),
  );
}
export async function validatePurge(learning, r) {
  if (r.confirm !== true) throw new Error('请先确认永久删除的笔记');
  if (!Array.isArray(r.ids) || !r.ids.length || r.ids.length > 10000) throw new Error('请选择回收站中的笔记');
  const ids = [...new Set(r.ids.map(assertId))];
  for (const id of ids) {
    if (learning.store.purged.has(id)) continue;
    let board;
    try {
      board = await learning.store.read(id);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (!board.deletedAt) throw new Error('只能永久删除回收站中的笔记，请刷新后重试');
  }
  return ids;
}
async function clearCaptureFile(store, ids) {
  const file = join(store.root, 'capture.json'),
    config = await load(file);
  if (!config) return;
  config.purgedRequests = [
    ...new Set([
      ...(config.purgedRequests || []),
      ...Object.entries(config.requests || {})
        .filter(([, v]) => ids.has(v.id))
        .map(([key]) => key),
    ]),
  ];
  config.requests = Object.fromEntries(
    Object.entries(config.requests || {}).filter(([, v]) => !ids.has(v.id)),
  );
  await atomicWrite(file, config);
  await copyFile(file, file + '.bak');
}
async function finishPurge(learning, marker) {
  const store = learning.store,
    ids = new Set(marker.ids),
    next = structuredClone(learning.data);
  const removedCards = new Set(
    Object.values(next.cards)
      .filter((c) => ids.has(c.boardId) || c.sourceRefs?.some((ref) => ids.has(ref.boardId)))
      .map((c) => c.id),
  );
  for (const id of removedCards) delete next.cards[id];
  next.reviews = next.reviews.filter((r) => !removedCards.has(r.cardId));
  const remaining = await store.all();
  if (remaining.errors.length) throw new Error('有笔记读取失败，无法确认剩余概念关系');
  const surviving = conceptIds(remaining.boards),
    deadConcepts = new Set(marker.deadConcepts.filter((id) => !surviving.has(id)));
  next.links = next.links.filter((l) => !deadConcepts.has(l.from) && !deadConcepts.has(l.to));
  if (next.graphReport?.id === marker.reportId) delete next.graphReport;
  await learning.commit(next);
  // The ordinary one-version backup must not retain permanently deleted cards.
  await copyFile(learning.file, learning.file + '.bak');
  for (const name of await entries(store.root))
    if (/^learning\.json\..+\.tmp$/.test(name)) await remove(join(store.root, name));
  for (const name of await entries(join(store.root, 'boards')))
    if (marker.ids.some((id) => name === id + '.json' || name.startsWith(id + '.json.')))
      await remove(join(store.root, 'boards', name));
  for (const directory of ['summary-inputs', 'graph-inputs']) {
    for (const name of await entries(join(store.root, directory))) {
      const roots = directory === 'summary-inputs' ? marker.summaryInputs : marker.graphInputs;
      if (roots.some((id) => name === id + '.json' || name.startsWith(id + '.json.')))
        await remove(join(store.root, directory, name));
    }
  }
  return { deleted: marker.count, ids: marker.ids };
}
export async function purgeNotes(learning, r, { afterDelete } = {}) {
  const store = learning.store,
    dir = join(store.root, 'purge-pending');
  await validatePurge(learning, r);
  await resumePurges(learning, { afterDelete });
  let started = false;
  try {
    const result = await store.serial(async () => {
      const ids = await validatePurge(learning, r),
        selected = new Set(ids),
        all = await store.all();
      if (all.errors.length) throw new Error('有笔记读取失败，暂时无法清理关联数据，请先处理读取错误');
      const targets = all.boards.filter((b) => selected.has(b.id)),
        remaining = all.boards.filter((b) => !selected.has(b.id)),
        liveConcepts = conceptIds(remaining);
      const summaryInputs = new Set(
          targets.flatMap((b) => b.summaries.map((s) => s.inputId).filter(Boolean)),
        ),
        graphInputs = new Set();
      for (const name of await entries(join(store.root, 'summary-inputs'))) {
        if (!name.includes('.json')) continue;
        try {
          const v = await load(join(store.root, 'summary-inputs', name));
          if (selected.has(v?.boardId)) summaryInputs.add(name.split('.json')[0]);
        } catch {}
      }
      for (const name of await entries(join(store.root, 'graph-inputs'))) {
        if (!name.includes('.json')) continue;
        try {
          const v = await load(join(store.root, 'graph-inputs', name));
          if (
            v?.sources?.some((s) => selected.has(s.boardId)) ||
            v?.nodes?.some((n) => n.sources?.some((s) => selected.has(s.boardId)))
          )
            graphInputs.add(name.split('.json')[0]);
        } catch {}
      }
      const report = learning.data.graphReport,
        linked =
          report &&
          (graphInputs.has(report.id) ||
            report.sourceBoardIds?.some((id) => selected.has(id)) ||
            report.connections?.some((c) =>
              [...(c.fromSources || []), ...(c.toSources || [])].some((s) => selected.has(s.boardId)),
            ));
      const marker = {
        version: 1,
        id: randomUUID(),
        ids,
        count: targets.length,
        deadConcepts: [
          ...new Set(
            [...conceptIds(targets)]
              .filter((id) => !liveConcepts.has(id))
              .concat(
                (report?.entities || [])
                  .filter((e) => e.sources?.length && e.sources.every((s) => selected.has(s.boardId)))
                  .map((e) => e.id),
              ),
          ),
        ],
        summaryInputs: [...summaryInputs],
        graphInputs: [...graphInputs],
        reportId: linked ? report.id : null,
        createdAt: new Date().toISOString(),
      };
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await atomicWrite(join(dir, marker.id + '.json'), marker);
      started = true;
      const purged = { ...store.purgedData };
      for (const id of ids) purged[id] = marker.createdAt;
      await atomicWrite(store.purgedFile, purged);
      store.purgedData = purged;
      store.purged = new Set(Object.keys(purged));
      return { ...(await finishPurge(learning, marker)), marker };
    });
    const ids = new Set(result.ids);
    if (afterDelete) await afterDelete(result.ids);
    else await clearCaptureFile(store, ids);
    await remove(join(dir, result.marker.id + '.json'));
    await remove(join(dir, result.marker.id + '.json.bak'));
    return { deleted: result.deleted, ids: result.ids };
  } catch (error) {
    if (started) {
      const e = new Error('永久删除已开始，剩余清理会在下次启动或重试时继续。' + error.message);
      e.code = 'PURGE_PENDING';
      throw e;
    }
    throw error;
  }
}
export async function resumePurges(learning, { afterDelete } = {}) {
  const store = learning.store,
    dir = join(store.root, 'purge-pending');
  for (const name of await entries(dir)) {
    if (!name.endsWith('.json')) continue;
    const marker = await load(join(dir, name));
    if (!marker) continue;
    if (marker.version !== 1 || !Array.isArray(marker.ids)) throw new Error('永久删除任务记录损坏');
    marker.ids.forEach(assertId);
    await store.serial(async () => {
      const data = { ...store.purgedData };
      for (const id of marker.ids) data[id] = marker.createdAt;
      await atomicWrite(store.purgedFile, data);
      store.purgedData = data;
      store.purged = new Set(Object.keys(data));
      await finishPurge(learning, marker);
    });
    if (afterDelete) await afterDelete(marker.ids);
    else await clearCaptureFile(store, new Set(marker.ids));
    await remove(join(dir, name));
    await remove(join(dir, name + '.bak'));
  }
}
