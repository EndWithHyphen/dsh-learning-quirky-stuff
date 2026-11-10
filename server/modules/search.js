import { digest, normalized, unique, requiredText } from '../lib/values.js';
import { imageFingerprint } from '../sources.js';
import { originalSummaryElements } from '../../summary-sources.js';
import { inkSignature } from '../../shared/ink.js';

export function queryTokens(query) {
  const text = normalized(query).replace(/为什么|怎么办|是什么|怎么|如何|哪些|什么|请问|关于/g, '');
  const latin = text.match(/[a-z0-9_]{2,}/g) || [],
    han = [...text.matchAll(/[\p{Script=Han}]+/gu)].flatMap((match) => {
      const chars = [...match[0]],
        result = [];
      for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
      if (chars.length === 1) result.push(chars[0]);
      return result;
    });
  return unique([...latin, ...han]).slice(0, 30);
}
export function rankSources(query, records, limit = 40) {
  const q = normalized(query),
    tokens = queryTokens(query);
  if (!q) return [];
  const rows = records.map((source) => ({
      source,
      body: normalized(source.text),
      title: normalized(source.title),
    })),
    frequencies = new Map(
      tokens.map((token) => [
        token,
        rows.filter((row) => row.body.includes(token) || row.title.includes(token)).length,
      ]),
    );
  return rows
    .map((row) => {
      let score = row.body.includes(q) ? 15 : 0;
      if (row.title.includes(q)) score += 25;
      for (const token of tokens) {
        const idf = Math.log(1 + rows.length / (1 + (frequencies.get(token) || 0)));
        if (row.body.includes(token)) score += idf;
        if (row.title.includes(token)) score += idf * 2;
      }
      const first =
        tokens
          .map((token) => row.body.indexOf(token))
          .filter((index) => index >= 0)
          .sort((a, b) => a - b)[0] || 0;
      return { ...row.source, score, snippet: row.source.text.slice(Math.max(0, first - 50), first + 230) };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export class SearchModule {
  constructor(context) {
    Object.assign(this, context);
    this.id = 'search';
  }
  register(router) {
    router.register('search.query', (request) => this.query(request), 'search');
    router.register('search.plan', () => this.plan(), 'search');
    router.register('search.index', (request) => this.startIndex(request), 'search');
    router.register('search.correct', (request) => this.correct(request), 'search');
    router.register('search.ocrRecords', (request) => this.ocrRecords(request.id), 'search');
    router.register('search.recognizeImage', (request) => this.recognizeImage(request), 'search');
    router.register('search.confirmImage', (request) => this.confirmImage(request), 'search');
  }
  async imageSource(id, imageId, expectedHash) {
    const board = await this.sources.note(id);
    if (board.deletedAt || this.store.purged.has(id)) throw new Error('请先恢复笔记');
    const image = board.scene.elements.find((e) => e.id === imageId && e.type === 'image' && !e.isDeleted);
    const file = image && board.scene.files[image.fileId];
    if (!image || !file?.dataURL) throw new Error('图片尚未保存完整，请先同步画布');
    const hash = imageFingerprint(image, file);
    if (expectedHash && hash !== expectedHash) throw new Error('图片已变化，请重新识别');
    return { image, file, hash };
  }
  async recognizeImage({ id, imageId, force = false }) {
    const source = await this.imageSource(id, imageId);
    const entry = (await this.index.get(id, { optional: true }))?.images?.[imageId];
    if (!force && entry?.hash === source.hash)
      return {
        status: 'done',
        result: { imageId, hash: source.hash, text: entry.manualText ?? entry.text, cached: true },
      };
    return this.tasks.start({
      feature: 'search',
      key: 'image:' + id + ':' + imageId + ':' + source.hash,
      title: '识别图中文字',
      references: { noteIds: [id] },
      request: { id, imageId },
      run: async (job) => {
        job.progress('正在本机识别图中文字');
        const result = await this.native.read(Buffer.from(source.file.dataURL.split(',')[1], 'base64'), {
          crop: source.image.crop,
          signal: job.signal,
        });
        const text = result.lines.map((line) => line.text).join('\n');
        await this.index.update(
          id,
          async (old) => {
            job.assertActive();
            await this.imageSource(id, imageId, source.hash);
            const previous = old?.images?.[imageId];
            return {
              ...old,
              version: 1,
              boardId: id,
              updatedAt: new Date().toISOString(),
              images: {
                ...old?.images,
                [imageId]: {
                  hash: source.hash,
                  text,
                  lines: result.lines,
                  manualText: previous?.hash === source.hash ? previous.manualText : null,
                },
              },
            };
          },
          { optional: true },
        );
        return { imageId, hash: source.hash, text, cached: false };
      },
    });
  }
  async confirmImage({ id, imageId, hash, text }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 50000)
      throw new Error('请填写识别文字，最多 50000 字');
    if (!hash) throw new Error('请先识别图片');
    await this.index.update(id, async (index) => {
      await this.imageSource(id, imageId, hash);
      const entry = index?.images?.[imageId];
      if (!entry || entry.hash !== hash) throw new Error('识别记录已变化，请重新识别');
      entry.manualText = text;
      index.updatedAt = new Date().toISOString();
      return index;
    });
    return { updated: true };
  }
  async plan() {
    const result = [];
    for (const id of await this.sources.noteIds()) {
      const board = await this.sources.note(id);
      if (board.deletedAt) continue;
      const index = await this.index.get(id, { optional: true }),
        images = originalSummaryElements(board.scene.elements, board.summaries).filter(
          (element) => element.type === 'image',
        );
      const pendingImages = images.filter(
          (element) =>
            index?.images?.[element.id]?.hash !==
            imageFingerprint(element, board.scene.files[element.fileId]),
        ).length,
        signature = inkSignature(board.scene),
        pendingInk = !!signature && index?.ink?.signature !== signature;
      if (pendingImages || pendingInk)
        result.push({ id, title: board.title, pendingImages, pendingInk, inkSignature: signature });
    }
    return result;
  }
  async query(request) {
    const query = requiredText(request.query, '搜索内容', 300),
      materials = (await this.materials.list()).filter((value) => !value.deletedAt),
      records = [
        ...(await this.sources.collect({
          materialIds: materials.map((value) => value.id),
          allSummaries: true,
        })),
        ...(await this.sources.reportRecords()),
      ];
    let matches = rankSources(query, records, 60);
    const graph = this.learning.data.graphReport;
    if ([2, 3].includes(graph?.schemaVersion)) {
      const q = normalized(query),
        aliases = graph.entities.filter((entity) =>
          [entity.name, ...entity.aliases].some(
            (name) => q.includes(normalized(name)) || normalized(name).includes(q),
          ),
        );
      const linked = new Set(aliases.flatMap((entity) => entity.sources.map((source) => source.id)));
      for (const source of records)
        if (linked.has(source.id) && !matches.some((row) => row.id === source.id))
          matches.push({ ...source, score: 2, snippet: source.text.slice(0, 230) });
    }
    if (request.kind) matches = matches.filter((row) => row.kind === request.kind);
    return { matches: matches.slice(0, 60), pending: await this.plan(), totalSources: records.length };
  }
  async startIndex(request) {
    const plan = await this.plan(),
      ids = unique(request.noteIds || plan.slice(0, 10).map((note) => note.id)).slice(0, 10);
    if (!ids.length) return { status: 'done', result: { indexed: 0, errors: [] } };
    const ink = request.ink || {};
    if (JSON.stringify(ink).length > 24000000) throw new Error('手写预览过大，请分批建立索引');
    return this.tasks.start({
      feature: 'search',
      key: 'index:' + ids.sort().join(','),
      title: '识别图片与手写',
      references: { noteIds: ids },
      request: { noteIds: ids },
      run: async (job) => {
        let indexed = 0;
        const errors = [];
        for (const id of ids) {
          job.assertActive();
          const board = await this.sources.note(id);
          if (board.deletedAt) continue;
          const old = await this.index.get(id, { optional: true }),
            next = {
              version: 1,
              boardId: id,
              images: { ...old?.images },
              ink: old?.ink || null,
              updatedAt: new Date().toISOString(),
            };
          const images = originalSummaryElements(board.scene.elements, board.summaries).filter(
            (element) => element.type === 'image',
          );
          for (const [position, element] of images.entries()) {
            job.assertActive();
            const file = board.scene.files[element.fileId],
              hash = imageFingerprint(element, file);
            if (next.images[element.id]?.hash === hash) continue;
            job.progress('正在识别「' + board.title + '」图片 ' + (position + 1) + ' / ' + images.length);
            try {
              const result = await this.native.read(Buffer.from(file.dataURL.split(',')[1], 'base64'), {
                crop: element.crop,
                signal: job.signal,
              });
              next.images[element.id] = {
                hash,
                text: result.lines.map((line) => line.text).join('\n'),
                lines: result.lines,
                manualText: null,
              };
              indexed++;
            } catch (error) {
              if (job.signal.aborted) throw error;
              errors.push({ noteId: id, imageId: element.id, message: error.message });
            }
          }
          const snapshot = ink[id];
          if (snapshot && snapshot.signature === inkSignature(board.scene)) {
            const chunks = [];
            for (const chunk of snapshot.chunks || []) {
              job.assertActive();
              if (!/^data:image\/(png|jpeg);base64,/.test(chunk.dataURL) || chunk.dataURL.length > 8000000)
                throw new Error('手写预览格式不正确');
              job.progress('正在识别「' + board.title + '」手写内容');
              const result = await this.native.read(Buffer.from(chunk.dataURL.split(',')[1], 'base64'), {
                signal: job.signal,
              });
              chunks.push({
                id: digest(chunk.elementIds).slice(0, 16),
                elementIds: chunk.elementIds,
                text: result.lines.map((line) => line.text).join('\n'),
                lines: result.lines,
                manualText: null,
              });
              indexed++;
            }
            next.ink = { signature: snapshot.signature, chunks };
          }
          job.assertActive();
          if (this.store.purged.has(id)) continue;
          await this.index.update(
            id,
            async (latest) => {
              job.assertActive();
              const fresh = await this.sources.note(id);
              if (fresh.deletedAt || this.store.purged.has(id)) throw new Error('来源笔记已移除');
              const images = { ...latest?.images };
              for (const [imageId, entry] of Object.entries(next.images)) {
                const element = fresh.scene.elements.find((e) => e.id === imageId && !e.isDeleted);
                if (!element || imageFingerprint(element, fresh.scene.files[element.fileId]) !== entry.hash)
                  continue;
                const current = images[imageId];
                images[imageId] = {
                  ...entry,
                  manualText: current?.hash === entry.hash ? current.manualText : entry.manualText,
                };
              }
              let ink = latest?.ink || null;
              if (next.ink?.signature && next.ink.signature === inkSignature(fresh.scene)) {
                ink = {
                  ...next.ink,
                  chunks: next.ink.chunks.map((chunk) => {
                    const current =
                      latest?.ink?.signature === next.ink.signature &&
                      latest.ink.chunks.find((c) => c.id === chunk.id);
                    return { ...chunk, manualText: current ? current.manualText : chunk.manualText };
                  }),
                };
              }
              return { ...next, images, ink };
            },
            { optional: true },
          );
        }
        return { indexed, errors };
      },
    });
  }
  async ocrRecords(id) {
    const board = await this.sources.note(id);
    if (board.deletedAt) throw new Error('请先恢复笔记');
    const index = await this.index.get(id, { optional: true });
    if (!index) return [];
    return [
      ...Object.entries(index.images || {})
        .filter(([imageId]) =>
          board.scene.elements.some((element) => element.id === imageId && !element.isDeleted),
        )
        .map(([imageId, entry]) => ({
          imageId,
          chunkId: null,
          text: entry.manualText ?? entry.text,
          manual: entry.manualText != null,
        })),
      ...(index.ink?.signature === inkSignature(board.scene)
        ? index.ink.chunks.map((chunk) => ({
            imageId: null,
            chunkId: chunk.id,
            text: chunk.manualText ?? chunk.text,
            manual: chunk.manualText != null,
          }))
        : []),
    ];
  }
  async correct(request) {
    await this.index.update(request.id, async (index) => {
      const board = await this.sources.note(request.id);
      if (board.deletedAt || this.store.purged.has(request.id)) throw new Error('请先恢复笔记');
      const text = typeof request.text === 'string' ? request.text.slice(0, 50000) : '';
      if (request.imageId) {
        const { hash } = await this.imageSource(request.id, request.imageId);
        const entry = index.images[request.imageId];
        if (!entry || entry.hash !== hash) throw new Error('图片已变化，请重新识别');
        entry.manualText = text;
      } else {
        if (index.ink?.signature !== inkSignature(board.scene)) throw new Error('手写已变化，请重新识别');
        const chunk = index.ink.chunks.find((chunk) => chunk.id === request.chunkId);
        if (!chunk) throw new Error('识别记录不存在');
        chunk.manualText = text;
      }
      return index;
    });
    return { updated: true };
  }
}
