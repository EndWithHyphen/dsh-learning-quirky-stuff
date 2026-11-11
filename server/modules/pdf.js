import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open, rename, rm, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertId, atomicWrite } from '../../core.js';
import { JsonRepository } from '../lib/storage.js';
import { requiredText, optionalText, digest, cancelled } from '../lib/values.js';
import {
  PDF_CHUNK_BYTES,
  PDF_MAX_BYTES,
  validPdfRect,
  normalizePdfText,
  pdfReference,
  pdfCommentElement,
  pdfSelectionText,
} from '../../shared/pdf.js';

/** PDFs are immutable shared assets. Links live on notes; annotations belong to each note. */
export class PdfModule {
  constructor(context) {
    Object.assign(this, context);
    this.id = 'pdf';
    this.documents = new JsonRepository(this.store.root, 'pdf-documents');
    this.notebooks = new JsonRepository(this.store.root, 'pdf-notebooks');
    this.pages = new JsonRepository(this.store.root, 'pdf-pages');
    this.uploads = new JsonRepository(this.store.root, 'pdf-uploads');
    this.filesRoot = join(this.store.root, 'modules', 'pdf-files');
    this.assetRoot = fileURLToPath(new URL('../../pdf-assets/', import.meta.url));
    this.tail = Promise.resolve();
  }
  serial(fn) {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async init() {
    for (const repo of [this.documents, this.notebooks, this.pages, this.uploads]) await repo.init();
    await mkdir(this.filesRoot, { recursive: true, mode: 0o700 });
    for (const upload of await this.uploads.list())
      if (Date.now() - Date.parse(upload.createdAt) > 86400000) await this.clearUpload(upload.id);
  }
  register(router) {
    router.register('pdf.backupRead', (request) => this.backupRead(request));
    for (const method of [
      'list',
      'catalog',
      'beginUpload',
      'uploadChunk',
      'finishUpload',
      'cancelUpload',
      'read',
      'info',
      'indexPage',
      'annotate',
      'position',
      'link',
      'unlink',
      'asset',
      'recognize',
    ])
      router.register('pdf.' + method, (request) => this[method](request), 'pdf');
  }
  async note(noteId) {
    const note = await this.store.read(noteId);
    if (note.deletedAt) throw new Error('请先恢复笔记');
    return note;
  }
  async linked(noteId, documentId) {
    const note = await this.note(noteId),
      id = assertId(documentId);
    if (!note.pdfDocuments?.some((d) => d.id === id)) throw new Error('这份 PDF 尚未关联到当前笔记');
    const document = await this.documents.get(id);
    return { note, document };
  }
  async list({ noteId }) {
    const note = await this.note(noteId),
      documents = [];
    for (const link of note.pdfDocuments || [])
      documents.push({ ...(await this.documents.get(link.id)), linkedAt: link.linkedAt });
    return {
      documents,
      notebook: (await this.notebooks.get(noteId, { optional: true })) || {
        id: noteId,
        annotations: [],
        positions: {},
      },
    };
  }
  async catalog({ noteId }) {
    await this.note(noteId);
    const { boards } = await this.store.all(),
      live = boards.filter((b) => !b.deletedAt),
      result = [];
    for (const document of await this.documents.list()) {
      const notes = live.filter((b) =>
        [...(b.pdfDocuments || []).map((d) => d.id), ...(b.pdfHistory || [])].includes(document.id),
      );
      if (notes.length)
        result.push({
          ...document,
          notes: notes.map((b) => ({ id: b.id, title: b.title })),
          linked: notes.some((b) => b.id === noteId && b.pdfDocuments?.some((d) => d.id === document.id)),
        });
    }
    return result;
  }
  async addLink(noteId, document) {
    return this.store.serial(async () => {
      const note = await this.note(noteId);
      if (!note.pdfDocuments?.some((d) => d.id === document.id)) {
        note.pdfDocuments = [
          ...(note.pdfDocuments || []),
          { id: document.id, title: document.name, linkedAt: new Date().toISOString() },
        ];
        note.pdfHistory = (note.pdfHistory || []).filter((id) => id !== document.id);
        note.updatedAt = new Date().toISOString();
        await atomicWrite(this.store.boardPath(noteId), note);
      }
      return this.store.meta(note);
    });
  }
  async link({ noteId, documentId }) {
    return this.serial(async () => this.addLink(noteId, await this.documents.get(assertId(documentId))));
  }
  async unlink({ noteId, documentId }) {
    await this.linked(noteId, documentId);
    await this.tasks.cancelWhere(
      (job) =>
        job.references.noteIds?.includes(noteId) &&
        job.request?.canvasKind === 'pdf' &&
        job.request.documentId === documentId,
      cancelled('PDF 已移除关联', 'SOURCE_REMOVED'),
    );
    return this.store.serial(async () => {
      const note = await this.note(noteId);
      note.pdfDocuments = (note.pdfDocuments || []).filter((d) => d.id !== documentId);
      note.pdfHistory = [...new Set([...(note.pdfHistory || []), documentId])];
      note.updatedAt = new Date().toISOString();
      await atomicWrite(this.store.boardPath(noteId), note);
      return this.store.meta(note);
    });
  }
  async beginUpload({ noteId, name, size, requestId }) {
    await this.note(noteId);
    assertId(requestId);
    name = requiredText(name, 'PDF 文件名', 240).split(/[\\/]/).at(-1);
    if (!/\.pdf$/i.test(name)) throw new Error('请选择 PDF 文件');
    if (!Number.isSafeInteger(size) || size < 8 || size > PDF_MAX_BYTES)
      throw new Error('PDF 大小需在 8 字节至 128 MB 之间');
    return this.serial(async () => {
      const previous = await this.uploads.get(requestId, { optional: true });
      if (previous) {
        if (previous.noteId !== noteId || previous.name !== name || previous.size !== size)
          throw new Error('上传请求与原文件不一致');
        return { ...previous, chunkSize: PDF_CHUNK_BYTES };
      }
      const record = { id: requestId, noteId, name, size, received: [], createdAt: new Date().toISOString() };
      await mkdir(join(this.uploads.root, requestId + '.parts'), { recursive: true, mode: 0o700 });
      await this.uploads.put(record.id, record);
      return { ...record, chunkSize: PDF_CHUNK_BYTES };
    });
  }
  async uploadChunk({ noteId, uploadId, index, data }) {
    return this.serial(async () => {
      await this.note(noteId);
      const upload = await this.uploads.get(assertId(uploadId));
      if (upload.noteId !== noteId) throw new Error('上传不属于当前笔记');
      const count = Math.ceil(upload.size / PDF_CHUNK_BYTES);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= count ||
        typeof data !== 'string' ||
        data.length > PDF_CHUNK_BYTES * 1.4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      )
        throw new Error('PDF 分块数据不正确');
      const bytes = Buffer.from(data, 'base64'),
        expected = Math.min(PDF_CHUNK_BYTES, upload.size - index * PDF_CHUNK_BYTES);
      if (bytes.length !== expected) throw new Error('PDF 分块大小不正确');
      const file = join(this.uploads.root, uploadId + '.parts', String(index));
      if (upload.received.includes(index)) {
        if (!(await readFile(file)).equals(bytes)) throw new Error('重试上传的内容不一致');
      } else {
        await writeFile(file, bytes, { mode: 0o600 });
        upload.received.push(index);
        await this.uploads.put(uploadId, upload);
      }
      return { received: upload.received.length, total: count };
    });
  }
  async finishUpload({ noteId, uploadId }) {
    return this.serial(async () => {
      await this.note(noteId);
      const upload = await this.uploads.get(assertId(uploadId));
      if (upload.noteId !== noteId) throw new Error('上传不属于当前笔记');
      if (upload.documentId) {
        const document = await this.documents.get(upload.documentId);
        await this.addLink(noteId, document);
        return document;
      }
      const count = Math.ceil(upload.size / PDF_CHUNK_BYTES);
      if (upload.received.length !== count) throw new Error('PDF 尚未上传完整，请重试');
      const temp = join(this.uploads.root, uploadId + '.pdf'),
        handle = await open(temp, 'w', 0o600),
        hash = createHash('sha256');
      try {
        for (let i = 0; i < count; i++) {
          const bytes = await readFile(join(this.uploads.root, uploadId + '.parts', String(i)));
          if (i === 0 && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
            throw new Error('文件内容不是有效的 PDF');
          hash.update(bytes);
          await handle.writeFile(bytes);
        }
      } finally {
        await handle.close();
      }
      const id = hash.digest('hex'),
        document = await this.documents.update(
          id,
          (old) =>
            old || {
              id,
              name: upload.name,
              size: upload.size,
              pageCount: null,
              createdAt: new Date().toISOString(),
            },
          { optional: true },
        );
      await rename(temp, join(this.filesRoot, id + '.pdf'));
      await this.addLink(noteId, document);
      await this.uploads.put(uploadId, { ...upload, documentId: id });
      await rm(join(this.uploads.root, uploadId + '.parts'), { recursive: true, force: true });
      return document;
    });
  }
  async clearUpload(id) {
    await rm(join(this.uploads.root, assertId(id) + '.parts'), { recursive: true, force: true });
    await rm(join(this.uploads.root, id + '.pdf'), { force: true });
    await this.uploads.remove(id);
  }
  async cancelUpload({ noteId, uploadId }) {
    return this.serial(async () => {
      const u = await this.uploads.get(assertId(uploadId), { optional: true });
      if (u && u.noteId !== noteId) throw new Error('上传不属于当前笔记');
      await this.clearUpload(uploadId);
      return { cancelled: true };
    });
  }
  async read({ noteId, documentId, offset = 0, length = PDF_CHUNK_BYTES }) {
    const { document } = await this.linked(noteId, documentId);
    return this.fileRange(document, offset, length);
  }
  async backupRead({ documentId, offset = 0, length = PDF_CHUNK_BYTES }) {
    return this.fileRange(await this.documents.get(assertId(documentId)), offset, length);
  }
  async fileRange(document, offset, length) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= document.size ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 2 * PDF_CHUNK_BYTES
    )
      throw new Error('PDF 读取范围不正确');
    const handle = await open(join(this.filesRoot, document.id + '.pdf'), 'r');
    try {
      const buffer = Buffer.alloc(Math.min(length, document.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead !== buffer.length) throw new Error('PDF 原件读取不完整，请恢复备份或重新导入');
      return { data: buffer.subarray(0, bytesRead).toString('base64'), size: document.size };
    } finally {
      await handle.close();
    }
  }
  async info({ noteId, documentId, pageCount, title }) {
    await this.linked(noteId, documentId);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10000) throw new Error('PDF 页数不支持');
    return this.documents.update(documentId, (d) => {
      if (d.pageCount && d.pageCount !== pageCount) throw new Error('PDF 页数与保存的文件不一致');
      return { ...d, pageCount, title: optionalText(title, 500) };
    });
  }
  async validPage(noteId, documentId, page) {
    const value = await this.linked(noteId, documentId);
    if (!Number.isInteger(page) || page < 1 || !value.document.pageCount || page > value.document.pageCount)
      throw new Error('PDF 页码不正确');
    return value;
  }
  async indexPage({ noteId, documentId, page, text, label, view, items = [] }) {
    await this.validPage(noteId, documentId, page);
    if (typeof text !== 'string' || text.length > 200000 || !validPdfRect(view))
      throw new Error('PDF 页面文字或尺寸不正确');
    if (
      !Array.isArray(items) ||
      items.length > 20000 ||
      items.some(
        (item) => typeof item.text !== 'string' || item.text.length > 20000 || !validPdfRect(item.rect),
      )
    )
      throw new Error('PDF 文字位置不正确');
    const id = documentId + '_' + page;
    const value = await this.pages.update(
      id,
      (old) =>
        old
          ? old.items?.length || !items.length
            ? old
            : { ...old, items }
          : {
              id,
              documentId,
              page,
              text,
              label: optionalText(label, 60) || String(page),
              view,
              hash: digest(text),
              items,
            },
      { optional: true },
    );
    await this.documents.update(documentId, (d) => ({
      ...d,
      indexedPages: [...new Set([...(d.indexedPages || []), page])].sort((a, b) => a - b),
    }));
    return value;
  }
  async annotate(request) {
    const { noteId, documentId, page } = request,
      { document } = await this.validPage(noteId, documentId, page),
      id = assertId(request.id);
    const kind = request.kind,
      rects = request.rects || [],
      points = request.points || [],
      quote = optionalText(request.quote, 30000),
      note = optionalText(request.note, 6000);
    if ((request.quote?.length || 0) > 30000 || (request.note?.length || 0) > 6000)
      throw new Error('批注内容较长，请缩小选区或缩短备注');
    if (
      !['highlight', 'ink', 'reference'].includes(kind) ||
      !Array.isArray(rects) ||
      rects.length > 300 ||
      !rects.every(validPdfRect) ||
      !Array.isArray(points) ||
      points.length > 10000 ||
      points.some(
        (p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6),
      )
    )
      throw new Error('PDF 批注范围不正确');
    if (kind === 'ink' ? points.length < 2 : !rects.length) throw new Error('请先选中原文或绘制笔迹');
    const indexed = await this.pages.get(documentId + '_' + page, { optional: true });
    if (!indexed) throw new Error('页面仍在载入，请稍后重试');
    const view = indexed.view,
      inside = (point) =>
        point[0] >= view[0] - 2 &&
        point[0] <= view[2] + 2 &&
        point[1] >= view[1] - 2 &&
        point[1] <= view[3] + 2;
    if (rects.some((r) => !inside(r.slice(0, 2)) || !inside(r.slice(2))) || points.some((p) => !inside(p)))
      throw new Error('批注超出页面范围');
    const expectedText =
      request.selectionType === 'region' ? pdfSelectionText(indexed.items || [], rects) : indexed.text;
    if (
      quote &&
      request.origin !== 'ocr' &&
      !normalizePdfText(expectedText).includes(normalizePdfText(quote))
    )
      throw new Error('选中文字与本页不一致，请重新选择；图表可使用框选');
    const stamp = digest({ documentId, page, kind, rects, points, quote }),
      requestHash = digest({ stamp, note, origin: request.origin || 'pdf', deleted: !!request.deleted });
    const result = await this.notebooks.update(
      noteId,
      async (old) => {
        await this.linked(noteId, documentId);
        old ||= { id: noteId, annotations: [], positions: {} };
        const prior = old.annotations.find((a) => a.id === id);
        if (prior && prior.documentId !== documentId) throw new Error('批注不属于这份 PDF');
        if (prior?.lastRequestId === request.requestId) {
          if (prior.requestHash !== requestHash) throw new Error('重试批注内容不一致');
          return old;
        }
        if (request.baseVersion !== (prior?.version || 0)) {
          throw new Error('批注已在另一窗口更新，请刷新后再修改');
        }
        const annotation = {
          id,
          noteId,
          documentId,
          page,
          pageLabel: indexed?.label || String(page),
          kind,
          rects,
          points,
          quote,
          selectionType: request.selectionType === 'region' ? 'region' : 'text',
          note,
          requestHash,
          origin: request.origin === 'ocr' ? 'ocr' : 'pdf',
          sourceHash: stamp,
          version: (prior?.version || 0) + 1,
          lastRequestId: assertId(request.requestId),
          createdAt: prior?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: request.deleted ? new Date().toISOString() : null,
        };
        return {
          ...old,
          annotations: prior
            ? old.annotations.map((a) => (a.id === id ? annotation : a))
            : [...old.annotations, annotation],
        };
      },
      { optional: true },
    );
    await this.store.metadata({ id: noteId });
    return result.annotations.find((a) => a.id === id);
  }
  async position({ noteId, documentId, page }) {
    await this.validPage(noteId, documentId, page);
    await this.notebooks.update(
      noteId,
      (old) => ({
        ...old,
        id: noteId,
        annotations: old?.annotations || [],
        positions: { ...old?.positions, [documentId]: page },
      }),
      { optional: true },
    );
    return { page };
  }
  async asset({ name }) {
    if (
      typeof name !== 'string' ||
      !/^(?:pdf\.worker\.min\.mjs|(?:cmaps|standard_fonts|wasm|iccs)\/[A-Za-z0-9_.-]+)$/.test(name)
    )
      throw new Error('PDF 阅读资源不存在');
    const file = resolve(this.assetRoot, name);
    if (!file.startsWith(resolve(this.assetRoot) + '/')) throw new Error('PDF 阅读资源不存在');
    return { data: (await readFile(file)).toString('base64') };
  }
  async commentScene(noteId, documentId) {
    const { document } = await this.linked(noteId, documentId),
      book = await this.notebooks.get(noteId, { optional: true });
    return {
      elements: (book?.annotations || [])
        .filter((a) => a.documentId === documentId)
        .map((a) => pdfCommentElement(document, a)),
      files: {},
    };
  }
  async recognize({ noteId, documentId, page, image }) {
    await this.validPage(noteId, documentId, page);
    if (
      !image ||
      !['image/png', 'image/jpeg'].includes(image.mimeType) ||
      typeof image.data !== 'string' ||
      image.data.length > 12_000_000 ||
      !/^[A-Za-z0-9+/=]+$/.test(image.data)
    )
      throw new Error('识别图像不正确');
    return this.tasks.start({
      feature: 'pdf',
      key: randomUUID(),
      title: '识别 PDF 第 ' + page + ' 页',
      references: { noteIds: [noteId] },
      request: { canvasKind: 'pdf', documentId },
      run: async (job) => {
        job.progress('正在本机识别选定区域');
        const result = await this.native.read(Buffer.from(image.data, 'base64'), { signal: job.signal });
        job.assertActive();
        await this.linked(noteId, documentId);
        return { text: result.lines.map((line) => line.text).join('\n'), documentId, page };
      },
    });
  }
  async records(noteId) {
    const note = await this.store.read(noteId);
    if (note.deletedAt) return [];
    const docs = new Map((note.pdfDocuments || []).map((d) => [d.id, d])),
      result = [];
    if (!docs.size) return result;
    const linkedPages = [];
    for (const documentId of docs.keys())
      for (const number of (await this.documents.get(documentId)).indexedPages || []) {
        const page = await this.pages.get(documentId + '_' + number, { optional: true });
        if (page) linkedPages.push(page);
      }
    for (const page of linkedPages)
      if (docs.has(page.documentId) && page.text)
        result.push({
          id: noteId + '/pdf/' + page.id,
          boardId: noteId,
          materialId: null,
          summaryId: null,
          title: docs.get(page.documentId).title + ' · 第 ' + page.page + ' 页',
          boardTitle: note.title,
          kind: 'material',
          text: page.text,
          hash: page.hash,
          url: null,
          locator: {
            elementIds: [],
            page: page.page,
            pdf: { documentId: page.documentId, page: page.page, title: docs.get(page.documentId).title },
          },
        });
    const book = await this.notebooks.get(noteId, { optional: true });
    for (const a of book?.annotations || [])
      if (!a.deletedAt && a.origin === 'ocr' && a.quote && docs.has(a.documentId))
        result.push({
          id: noteId + '/pdf-ocr/' + a.id,
          boardId: noteId,
          materialId: null,
          summaryId: null,
          title: 'PDF 识别文字（已核对）',
          boardTitle: note.title,
          kind: 'material',
          text: a.quote,
          hash: digest(a.quote),
          url: null,
          locator: {
            elementIds: [],
            page: a.page,
            pdf: pdfReference({ id: a.documentId, name: docs.get(a.documentId).title }, a),
          },
        });
    for (const a of book?.annotations || [])
      if (!a.deletedAt && a.note && docs.has(a.documentId))
        result.push({
          id: noteId + '/pdf-note/' + a.id,
          boardId: noteId,
          materialId: null,
          summaryId: null,
          title: '我的 PDF 批注',
          boardTitle: note.title,
          kind: 'annotation',
          text: a.note,
          hash: digest(a.note),
          url: null,
          locator: {
            elementIds: [],
            page: a.page,
            pdf: {
              documentId: a.documentId,
              page: a.page,
              rects: a.rects,
              title: docs.get(a.documentId).title,
            },
          },
        });
    return result;
  }
  async duplicate(fromId, toId) {
    const from = await this.store.read(fromId);
    for (const link of from.pdfDocuments || []) await this.link({ noteId: toId, documentId: link.id });
    const book = await this.notebooks.get(fromId, { optional: true });
    if (book)
      await this.notebooks.put(toId, {
        ...book,
        id: toId,
        annotations: book.annotations.map((a) => ({ ...a, noteId: toId })),
      });
  }
  async purge(ids) {
    return this.serial(() => this.purgeUnused(ids));
  }
  async purgeUnused(ids) {
    for (const id of ids) await this.notebooks.remove(id);
    for (const u of await this.uploads.list()) if (ids.includes(u.noteId)) await this.clearUpload(u.id);
    const { boards, errors } = await this.store.all();
    // An unreadable note may still own this shared original. Defer asset cleanup.
    if (errors.length) return;
    const used = new Set(
      boards.flatMap((b) => [...(b.pdfDocuments || []).map((d) => d.id), ...(b.pdfHistory || [])]),
    );
    for (const doc of await this.documents.list())
      if (!used.has(doc.id)) {
        await this.documents.remove(doc.id);
        await rm(join(this.filesRoot, doc.id + '.pdf'), { force: true });
        for (const p of await this.pages.list()) if (p.documentId === doc.id) await this.pages.remove(p.id);
      }
  }
  async backup({ separateFiles = false } = {}) {
    const documents = [];
    for (const doc of await this.documents.list())
      documents.push(
        separateFiles
          ? { ...doc, assetFile: 'pdfs/' + doc.id + '.pdf' }
          : { ...doc, data: (await readFile(join(this.filesRoot, doc.id + '.pdf'))).toString('base64') },
      );
    return { documents, notebooks: await this.notebooks.list(), pages: await this.pages.list() };
  }
}
