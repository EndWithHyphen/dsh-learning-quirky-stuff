import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { PdfAnnotationSession } from '../src/pdf/session.js';
import { pdfCommentElement, PDF_CHUNK_BYTES } from '../shared/pdf.js';
import { commentSourceContent } from '../shared/canvas-comments.js';
import { digest } from '../server/lib/values.js';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'study-pdf-')),
    store = await new LibraryStore(root).init(),
    learning = await new LearningStore(store).init(),
    calls = [];
  const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async text(options) {
        calls.push(options);
        return { text: '回答基于第 1 页的原文。', model: { id: 'fixture' } };
      },
    },
  }).init();
  t.after(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const note = await store.create({ title: 'PDF 笔记', tags: ['阅读'] }),
    second = await store.create({ title: '另一篇笔记' }),
    execute = (r) => runtime.execute(r);
  const bytes = await readFile('tests/fixtures/pdf-learning-sample.pdf');
  async function upload(noteId = note.id) {
    const id = randomUUID(),
      info = await execute({
        action: 'pdf.beginUpload',
        noteId,
        name: 'learning.pdf',
        size: bytes.length,
        requestId: id,
      });
    for (let i = 0; i < Math.ceil(bytes.length / info.chunkSize); i++)
      await execute({
        action: 'pdf.uploadChunk',
        noteId,
        uploadId: id,
        index: i,
        data: bytes.subarray(i * info.chunkSize, (i + 1) * info.chunkSize).toString('base64'),
      });
    const document = await execute({ action: 'pdf.finishUpload', noteId, uploadId: id });
    await execute({ action: 'pdf.info', noteId, documentId: document.id, pageCount: 4 });
    return { document, id };
  }
  return { store, learning, runtime, note, second, execute, bytes, upload, calls };
}
test('PDF 分块重试与去重，同一原件可关联多篇笔记；无关联笔记不能读取', async (t) => {
  const f = await fixture(t),
    { document, id } = await f.upload();
  assert.equal(
    (await f.execute({ action: 'pdf.finishUpload', noteId: f.note.id, uploadId: id })).id,
    document.id,
  );
  await assert.rejects(
    f.execute({ action: 'pdf.read', noteId: f.second.id, documentId: document.id }),
    /尚未关联/,
  );
  await f.execute({ action: 'pdf.link', noteId: f.second.id, documentId: document.id });
  const read = await f.execute({
    action: 'pdf.read',
    noteId: f.second.id,
    documentId: document.id,
    offset: 0,
    length: Math.min(f.bytes.length, PDF_CHUNK_BYTES),
  });
  assert.ok(Buffer.from(read.data, 'base64').equals(f.bytes.subarray(0, PDF_CHUNK_BYTES)));
  assert.equal((await f.upload()).document.id, document.id);
  assert.equal((await f.runtime.pdf.documents.list()).length, 1);
  assert.equal((await f.store.library()).boards.find((b) => b.id === f.note.id).pdfCount, 1);
  await assert.rejects(f.execute({ action: 'pdf.asset', name: '../../core.js' }), /不存在/);
  await assert.rejects(
    f.execute({ action: 'pdf.read', noteId: f.note.id, documentId: document.id, offset: -1 }),
    /范围/,
  );
});
test('PDF 批注按笔记隔离、拒绝旧版本覆盖、保留来源并纳入检索和备份', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload();
  await f.execute({ action: 'pdf.link', noteId: f.second.id, documentId: document.id });
  const page = {
    action: 'pdf.indexPage',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    text: 'A claim needs evidence and explicit assumptions.',
    view: [0, 0, 600, 800],
    label: 'i',
  };
  await f.execute(page);
  const request = {
    action: 'pdf.annotate',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    id: randomUUID(),
    kind: 'highlight',
    rects: [[20, 20, 100, 40]],
    quote: 'A claim needs evidence',
    note: '需要区分作者解释和证据',
    baseVersion: 0,
    requestId: randomUUID(),
  };
  const saved = await f.execute(request);
  assert.equal(saved.version, 1);
  assert.equal((await f.execute(request)).version, 1);
  await assert.rejects(f.execute({ ...request, requestId: randomUUID(), note: '旧窗口修改' }), /另一窗口/);
  await assert.rejects(
    f.execute({ ...request, id: randomUUID(), requestId: randomUUID(), quote: '伪造原文' }),
    /本页不一致/,
  );
  assert.equal((await f.execute({ action: 'pdf.list', noteId: f.second.id })).notebook.annotations.length, 0);
  const records = await f.runtime.sources.noteRecords(f.note.id);
  assert.ok(records.some((r) => r.text.includes('explicit assumptions') && r.locator.pdf.page === 1));
  assert.ok(records.some((r) => r.kind === 'annotation' && r.text === request.note));
  const backup = await f.runtime.backup();
  assert.equal(backup.pdf.documents.length, 1);
  assert.ok(Buffer.from(backup.pdf.documents[0].data, 'base64').equals(f.bytes));
  await f.execute({ ...request, requestId: randomUUID(), baseVersion: 1, deleted: true });
  assert.ok((await f.execute({ action: 'pdf.list', noteId: f.note.id })).notebook.annotations[0].deletedAt);
});
test('PDF 选区复用提问模块，模型收到页码引用及原文；跨笔记引用被拒绝', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload();
  await f.execute({
    action: 'pdf.indexPage',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    text: 'A claim needs evidence.',
    view: [0, 0, 600, 800],
  });
  const a = await f.execute({
    action: 'pdf.annotate',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    id: randomUUID(),
    kind: 'reference',
    rects: [[20, 20, 200, 40]],
    quote: 'A claim needs evidence.',
    baseVersion: 0,
    requestId: randomUUID(),
  });
  const request = {
    action: 'canvasComments.send',
    noteId: f.note.id,
    canvas: { kind: 'pdf', id: document.id },
    threadId: randomUUID(),
    requestId: randomUUID(),
    elementIds: [a.id],
    sourceHash: digest(commentSourceContent([pdfCommentElement(document, a)])),
    ask: true,
    body: '解释一下',
    image: { mimeType: 'image/png', data: 'YWJj' },
  };
  const { task } = await f.execute(request);
  for (let i = 0; i < 100 && f.runtime.tasks.get(task.id).status !== 'done'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(f.runtime.tasks.get(task.id).status, 'done', f.runtime.tasks.get(task.id).error);
  assert.match(f.calls[0].prompt, /原文出处/);
  assert.match(f.calls[0].prompt, /"page":1/);
  const [thread] = await f.execute({ ...request, action: 'canvasComments.list' });
  assert.equal(thread.messages.find((m) => m.role === 'assistant').references[0].page, 1);
  await assert.rejects(f.execute({ ...request, noteId: f.second.id }), /尚未关联/);
});
test('永久删除一篇笔记保留其他笔记共用的 PDF，最后一篇删除时清理原件', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload();
  await f.execute({ action: 'pdf.link', noteId: f.second.id, documentId: document.id });
  for (const note of [f.note, f.second]) {
    await f.store.metadata({ id: note.id, deleted: true });
    await f.runtime.beforePurge([note.id]);
    await f.learning.purge({ ids: [note.id], confirm: true });
    await f.runtime.purge([note.id]);
    assert.equal((await f.runtime.pdf.documents.list()).length, note.id === f.note.id ? 1 : 0);
  }
});
test('PDF 批注失去响应后保留请求编号重试，刷新后继续保存，不丢后续笔迹', async () => {
  let persisted,
    calls = [],
    first = true;
  const execute = async (request) => {
    calls.push(request);
    if (first) {
      first = false;
      throw new Error('response lost');
    }
    return { ...request, version: request.baseVersion + 1 };
  };
  const session = await new PdfAnnotationSession({
    execute,
    persist: async (value) => {
      persisted = structuredClone(value);
    },
    load: async () => null,
  }).init([]);
  await assert.rejects(
    session.add({
      id: 'one',
      kind: 'ink',
      points: [
        [1, 1],
        [2, 2],
      ],
    }),
    /response lost/,
  );
  const resumed = await new PdfAnnotationSession({
    execute,
    persist: async (value) => {
      persisted = structuredClone(value);
    },
    load: async () => persisted,
  }).init([]);
  await resumed.flush();
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(resumed.value()[0].version, 1);
  assert.equal(persisted.queue.length, 0);
});

test('PDF 框选可跳过另一栏文本，重试不能换内容，OCR 与个人笔记分别保留来源', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload();
  await f.execute({
    action: 'pdf.indexPage',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    text: 'Left first. Right first. Left second.',
    view: [0, 0, 600, 800],
    items: [
      { text: 'Left first.', rect: [20, 100, 200, 120], eol: true },
      { text: 'Right first.', rect: [320, 100, 500, 120], eol: true },
      { text: 'Left second.', rect: [20, 80, 200, 100], eol: true },
    ],
  });
  const req = {
    action: 'pdf.annotate',
    noteId: f.note.id,
    documentId: document.id,
    page: 1,
    id: randomUUID(),
    requestId: randomUUID(),
    baseVersion: 0,
    kind: 'highlight',
    rects: [[10, 75, 210, 125]],
    quote: 'Left first.\nLeft second.',
    selectionType: 'region',
    note: '我的推断',
  };
  await f.execute(req);
  await assert.rejects(f.execute({ ...req, note: '不同内容' }), /重试批注内容不一致/);
  const ocr = await f.execute({
    ...req,
    id: randomUUID(),
    requestId: randomUUID(),
    quote: '核对后的扫描原文',
    origin: 'ocr',
    note: '',
  });
  const records = await f.runtime.sources.noteRecords(f.note.id);
  assert.ok(records.some((r) => r.text === ocr.quote && r.locator.pdf.origin === 'ocr'));
  assert.ok(records.some((r) => r.text === '我的推断' && r.kind === 'annotation'));
  await f.runtime.pdf.duplicate(f.note.id, f.second.id);
  const copy = await f.execute({ action: 'pdf.list', noteId: f.second.id });
  assert.equal(copy.documents.length, 1);
  assert.ok(copy.notebook.annotations.every((a) => a.noteId === f.second.id));
});

test('PDF 备份 ZIP 分块包含原件一次，包括回收站引用；异常读数拒绝下载', async (t) => {
  const { packageNoteBackup } = await import('../src/pdf/backup.js'),
    { unzipSync, strFromU8 } = await import('fflate');
  const f = await fixture(t),
    { document } = await f.upload();
  await f.execute({ action: 'pdf.link', noteId: f.second.id, documentId: document.id });
  await f.store.metadata({ id: f.note.id, deleted: true });
  const backup = { modules: await f.runtime.backup({ separateFiles: true }) };
  assert.equal(backup.modules.pdf.documents.length, 1);
  assert.equal(backup.modules.pdf.documents[0].data, undefined);
  const packed = await packageNoteBackup(backup, f.execute),
    files = unzipSync(new Uint8Array(await packed.blob.arrayBuffer()));
  assert.equal(packed.extension, 'zip');
  assert.ok(Buffer.from(files['pdfs/' + document.id + '.pdf']).equals(f.bytes));
  assert.equal(JSON.parse(strFromU8(files['backup.json'])).modules.pdf.documents[0].id, document.id);
  await assert.rejects(
    packageNoteBackup(backup, async () => ({ data: 'YWJj' })),
    /读取不完整/,
  );
  await assert.rejects(
    packageNoteBackup({ modules: { pdf: { documents: [{ id: '../escape', size: 8 }] } } }, f.execute),
    /清单不正确/,
  );
});

test('可编辑摘录保留原句，并向学习模块标识用户修订', async () => {
  const { elementPdfReference } = await import('../shared/pdf.js');
  const e = {
    type: 'text',
    text: 'A claim\nneeds evidence.',
    customData: {
      studyboard: {
        role: 'pdf-excerpt',
        pdfSource: { documentId: 'sample', page: 1, quote: 'A claim needs evidence.', origin: 'pdf' },
      },
    },
  };
  assert.equal(elementPdfReference(e).edited, undefined);
  e.text = 'A claim needs no evidence.';
  assert.equal(elementPdfReference(e).edited, true);
  assert.equal(elementPdfReference(e).quote, 'A claim needs evidence.');
});

test('PDF 关闭功能会停止原页提问，并拒绝新的读取', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload();
  const job = await f.runtime.tasks.start({
    feature: 'canvasComments',
    key: randomUUID(),
    title: 'PDF pending question',
    references: { noteIds: [f.note.id] },
    request: { canvasKind: 'pdf', documentId: document.id },
    run: ({ signal }) =>
      new Promise((resolve, reject) => {
        signal.throwIfAborted();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  await f.runtime.updateConfig({ features: { pdf: false } });
  await f.runtime.tasks.jobs.get(job.id).task;
  assert.equal(f.runtime.tasks.get(job.id).status, 'cancelled');
  await assert.rejects(f.execute({ action: 'pdf.read', noteId: f.note.id, documentId: document.id }), /关闭/);
  assert.equal((await f.runtime.backup({ separateFiles: true })).pdf.documents.length, 1);
});

test('有笔记读取失败时暂缓共用 PDF 清理，避免误删仍被引用的原件', async (t) => {
  const f = await fixture(t),
    { document } = await f.upload(),
    original = f.store.all;
  f.store.all = async () => ({ boards: [], errors: [{ id: f.note.id, error: '磁盘读取失败' }] });
  try {
    await f.runtime.pdf.purge([]);
  } finally {
    f.store.all = original;
  }
  assert.equal((await f.runtime.pdf.documents.list()).length, 1);
  const read = await f.execute({ action: 'pdf.read', noteId: f.note.id, documentId: document.id });
  assert.ok(Buffer.from(read.data, 'base64').equals(f.bytes));
});
