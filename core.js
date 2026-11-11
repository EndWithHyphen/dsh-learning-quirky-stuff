import { mkdir, readFile, readdir, open, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  webNote,
  webImage,
  saveWebNotes,
  addWebImage,
  setWebImageDeleted,
  webCanvas,
  saveWebCanvas,
  reconcileWebImages,
} from './web-notes.js';
import { activeSummaries } from './summary-selection.js';
const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
export const text = (v, fallback = '', max = 200) =>
  typeof v === 'string' ? v.trim().slice(0, max) : fallback;
export const tags = (v) =>
  Array.isArray(v) ? [...new Set(v.map((t) => text(t, '', 40)).filter(Boolean))].slice(0, 30) : [];
export function assertId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(id)) throw new Error('无效的笔记或分类编号');
  return id;
}
export function validateScene(value) {
  const invalid = (message, code = 'INVALID_SCENE') => Object.assign(new Error(message), { code });
  if (
    !value ||
    !Array.isArray(value.elements) ||
    !value.files ||
    typeof value.files !== 'object' ||
    Array.isArray(value.files)
  )
    throw invalid('白板数据格式不正确');
  if (value.elements.length > 50000) throw invalid('这张白板的元素太多，请拆分为几篇笔记', 'SCENE_TOO_LARGE');
  const ids = new Set();
  for (const e of value.elements) {
    if (!e || typeof e.id !== 'string' || ids.has(e.id) || !Number.isFinite(e.x) || !Number.isFinite(e.y))
      throw invalid('白板元素损坏');
    ids.add(e.id);
    if (e.type === 'image' && !e.isDeleted && (!e.fileId || !value.files[e.fileId]))
      throw invalid('图片尚未保存完整，请稍后重试', 'IMAGE_DATA_PENDING');
  }
  for (const f of Object.values(value.files))
    if (!f || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(f.dataURL || ''))
      throw invalid('仅支持 PNG、JPEG、WebP、GIF 图片', 'INVALID_IMAGE_DATA');
  if (Buffer.byteLength(JSON.stringify(value)) > 60 * 1024 * 1024)
    throw invalid('单篇笔记超过 60 MB，请缩小图片或拆分笔记', 'SCENE_TOO_LARGE');
  return clone(value);
}
export async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await copyFile(file, `${file}.bak`).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
  await rename(temp, file);
}
export class LibraryStore {
  constructor(root) {
    this.root = root;
    this.tail = Promise.resolve();
    this.purged = new Set();
    this.purgedData = {};
    this.purgedFile = path.join(root, 'purged-notes.json');
  }
  serial(fn) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
  boardPath(id) {
    return path.join(this.root, 'boards', `${assertId(id)}.json`);
  }
  async init() {
    await mkdir(path.join(this.root, 'boards'), { recursive: true, mode: 0o700 });
    try {
      this.purgedData = JSON.parse(await readFile(this.purgedFile, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('永久删除记录无法读取');
    }
    if (!this.purgedData || typeof this.purgedData !== 'object' || Array.isArray(this.purgedData))
      throw new Error('永久删除记录格式不正确');
    this.purged = new Set(Object.keys(this.purgedData));
    this.foldersFile = path.join(this.root, 'folders.json');
    try {
      this.folders = JSON.parse(await readFile(this.foldersFile, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') this.folders = [];
      else throw new Error('分类文件无法读取，请先检查备份，未覆盖原文件');
    }
    if (!Array.isArray(this.folders)) throw new Error('分类文件格式不正确');
    return this;
  }
  async read(id) {
    assertId(id);
    if (this.purged.has(id)) {
      const e = new Error('这篇笔记已永久删除');
      e.code = 'NOTE_PURGED';
      throw e;
    }
    const b = JSON.parse(await readFile(this.boardPath(id), 'utf8'));
    if (b.schemaVersion !== 1 || b.id !== id) throw new Error('笔记版本不支持或文件损坏');
    return b;
  }
  async all() {
    const entries = await readdir(path.join(this.root, 'boards')),
      boards = [],
      errors = [];
    for (const entry of entries.filter((e) => e.endsWith('.json') && !this.purged.has(e.slice(0, -5))))
      try {
        boards.push(await this.read(entry.slice(0, -5)));
      } catch {
        errors.push(entry);
      }
    return { boards, errors };
  }
  meta(b) {
    const { scene, summaries, webImages, lastWebCanvasSave, ...meta } = b,
      active = activeSummaries(b);
    return {
      ...meta,
      webImageCount: (webImages || []).filter((i) => !i.deletedAt).length,
      summaryCount: active.length,
      summaryText: active.at(-1)?.text?.slice(0, 300) || '',
      pdfCount: b.pdfDocuments?.length || 0,
      textIndex: (
        (b.pdfDocuments || []).map((document) => document.title).join(' ') +
        ' ' +
        (b.webNotes?.text || '') +
        ' ' +
        scene.elements
          .filter((e) => e.type === 'text' && !e.isDeleted)
          .map((e) => e.text || '')
          .join(' ')
      ).slice(0, 12000),
    };
  }
  async library() {
    const { boards, errors } = await this.all();
    return {
      folders: clone(this.folders),
      boards: boards.map((b) => this.meta(b)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      errors,
      purgedIds: [...this.purged],
    };
  }
  folder(id) {
    if (id != null && !this.folders.some((f) => f.id === id)) throw new Error('分类已不存在');
    return id || null;
  }
  async create(r) {
    return this.serial(async () => {
      const date = now(),
        b = {
          schemaVersion: 1,
          id: randomUUID(),
          title: text(r.title, '新笔记') || '新笔记',
          folderId: this.folder(r.folderId),
          tags: tags(r.tags),
          createdAt: date,
          updatedAt: date,
          revision: 0,
          deletedAt: null,
          scene: { elements: [], appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} },
          summaries: [],
        };
      if (r.source) {
        let url;
        try {
          url = new URL(r.source.url);
        } catch {
          throw new Error('网页链接不正确');
        }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw new Error('只支持普通 HTTP / HTTPS 网页链接');
        b.source = { url: url.href, title: text(r.source.title, '', 500), capturedAt: date };
      }
      await atomicWrite(this.boardPath(b.id), b);
      return b;
    });
  }
  async save(r) {
    return this.serial(async () => {
      const b = await this.read(r.id);
      if (b.deletedAt) throw new Error('笔记已在回收站，请恢复后编辑');
      if (r.baseRevision !== b.revision)
        throw new Error('笔记已在另一个窗口更新。当前草稿已保留，请重新打开后恢复或另存');
      b.scene = reconcileWebImages(b, validateScene(r.scene));
      b.revision++;
      b.updatedAt = now();
      if (
        typeof r.thumbnail === 'string' &&
        r.thumbnail.length < 300000 &&
        /^data:image\/(png|jpeg|webp);base64,/.test(r.thumbnail)
      )
        b.thumbnail = r.thumbnail;
      await atomicWrite(this.boardPath(b.id), b);
      return this.meta(b);
    });
  }
  async metadata(r) {
    return this.serial(async () => {
      const b = await this.read(r.id);
      if ('title' in r) b.title = text(r.title) || '新笔记';
      if ('folderId' in r) b.folderId = this.folder(r.folderId);
      if ('tags' in r) b.tags = tags(r.tags);
      if ('deleted' in r) b.deletedAt = r.deleted ? now() : null;
      b.updatedAt = now();
      await atomicWrite(this.boardPath(b.id), b);
      return this.meta(b);
    });
  }
  async editFolder(r) {
    return this.serial(async () => {
      const next = clone(this.folders),
        id = r.id ? assertId(r.id) : randomUUID(),
        existing = next.find((f) => f.id === id),
        name = text(r.name, '', 80);
      if (!name) throw new Error('请填写分类名称');
      const parentId = this.folder(r.parentId);
      let ancestor = parentId;
      const seen = new Set();
      while (ancestor) {
        if (ancestor === id || seen.has(ancestor)) throw new Error('分类不能移到自己或自己的子分类中');
        seen.add(ancestor);
        ancestor = next.find((f) => f.id === ancestor)?.parentId;
      }
      if (next.some((f) => f.id !== id && f.name === name && f.parentId === parentId))
        throw new Error('同一层已有这个分类名称');
      const value = { id, name, parentId };
      if (existing) Object.assign(existing, value);
      else next.push(value);
      await atomicWrite(this.foldersFile, next);
      this.folders = next;
      return value;
    });
  }
  async deleteFolder(r) {
    return this.serial(async () => {
      const id = assertId(r.id);
      this.folder(id);
      const { boards, errors } = await this.all();
      if (errors.length) throw new Error('有笔记暂时无法读取，请先检查读取错误后再删除分类');
      const notes = boards.filter((b) => b.folderId === id && !b.deletedAt),
        children = this.folders.filter((f) => f.parentId === id),
        contents = [];
      if (notes.length) contents.push(`${notes.length} 篇未删除的笔记`);
      if (children.length) contents.push(`${children.length} 个子分类`);
      if (contents.length) throw new Error(`请先移走分类中的${contents.join('和')}，再删除空分类`);
      const trashed = boards.filter((b) => b.folderId === id && b.deletedAt);
      for (const b of trashed) await atomicWrite(this.boardPath(b.id), { ...b, folderId: null });
      const next = this.folders.filter((f) => f.id !== id);
      await atomicWrite(this.foldersFile, next);
      this.folders = next;
      return { deleted: true, releasedTrashNotes: trashed.length };
    });
  }
  async addSummary(id, summary) {
    return this.serial(async () => {
      const b = await this.read(id);
      if (
        summary.parentSummaryId &&
        !b.summaries.some((s) => s.id === summary.parentSummaryId && !s.deletedAt)
      )
        throw new Error('原总结已删除，未保存这次拓展');
      b.summaries.push({ ...summary, id: randomUUID(), createdAt: now() });
      b.updatedAt = now();
      await atomicWrite(this.boardPath(id), b);
      return b.summaries.at(-1);
    });
  }
  async setSummaryDeleted(r) {
    return this.serial(async () => {
      if (typeof r.deleted !== 'boolean') throw new Error('总结删除操作不正确');
      const b = await this.read(r.id);
      if (b.deletedAt) throw new Error('请先恢复笔记');
      const s = b.summaries.find((s) => s.id === r.summaryId);
      if (!s) throw new Error('找不到这次总结');
      if (!!s.deletedAt !== r.deleted) {
        s.deletedAt = r.deleted ? now() : null;
        b.updatedAt = now();
        await atomicWrite(this.boardPath(b.id), b);
      }
      return { summary: s, meta: this.meta(b) };
    });
  }
  async duplicate(r) {
    const source = await this.read(r.id),
      b = await this.create({
        title: source.title + '（副本）',
        folderId: source.folderId,
        tags: source.tags,
      });
    await this.save({ id: b.id, baseRevision: 0, scene: source.scene, thumbnail: source.thumbnail });
    return this.read(b.id);
  }
  async backup() {
    const { boards, errors } = await this.all();
    return {
      format: 'studyboard-backup',
      version: 1,
      createdAt: now(),
      folders: clone(this.folders),
      boards,
      errors,
    };
  }
  async dispatch(r) {
    if (!r || typeof r !== 'object') throw new Error('操作参数不正确');
    switch (r.action) {
      case 'setSummaryDeleted':
        return this.setSummaryDeleted(r);
      case 'webCanvas':
        return webCanvas(this, r);
      case 'saveWebCanvas':
        return saveWebCanvas(this, r);
      case 'setWebImageDeleted':
        return setWebImageDeleted(this, r);
      case 'webImage':
        return webImage(this, r);
      case 'webNote':
        return webNote(this, r);
      case 'saveWebNotes':
        return saveWebNotes(this, r);
      case 'addWebImage':
        return addWebImage(this, r);
      case 'library':
        return this.library();
      case 'read':
        return this.read(assertId(r.id));
      case 'create':
        return this.create(r);
      case 'save':
        return this.save(r);
      case 'metadata':
        return this.metadata(r);
      case 'folder':
        return this.editFolder(r);
      case 'deleteFolder':
        return this.deleteFolder(r);
      case 'duplicate':
        return this.duplicate(r);
      case 'backup':
        return this.backup();
      default:
        throw new Error('不支持的学习画板操作');
    }
  }
}
