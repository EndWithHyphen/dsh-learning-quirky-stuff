import { randomUUID } from 'node:crypto';
import { digest, publicUrl, optionalText, requiredText } from './lib/values.js';
import { splitParagraphs, parseSubtitles, readingMinutes } from '../shared/material-text.js';

export class MaterialLibrary {
  constructor(store, materials) {
    this.store = store;
    this.materials = materials;
  }
  async capture(request) {
    const url = request.url ? publicUrl(request.url) : null,
      title = optionalText(request.title, 300) || '导入材料';
    let blocks;
    if (request.boardId) {
      const board = await this.store.read(request.boardId);
      if (board.deletedAt) throw new Error('请先恢复笔记');
      if (url && board.source?.url && new URL(board.source.url).href !== url)
        throw new Error('材料与当前笔记来源不一致');
    }
    if (Array.isArray(request.blocks))
      blocks = request.blocks
        .slice(0, 1500)
        .map((block, i) => ({
          id: 'b' + (i + 1),
          text: optionalText(block.text, 10000),
          position: i,
          seconds: Number.isFinite(block.seconds) && block.seconds >= 0 ? block.seconds : null,
          domId: optionalText(block.domId, 100) || null,
          page: Number.isInteger(block.page) ? block.page : null,
          endSeconds: Number.isFinite(block.endSeconds) ? block.endSeconds : null,
        }))
        .filter((block) => block.text);
    else {
      const text = requiredText(request.text, '正文或字幕', 250000);
      blocks = parseSubtitles(text);
      if (!blocks.length) blocks = splitParagraphs(text);
    }
    if (!blocks.length) throw new Error('没有读取到正文或字幕，请粘贴文本或导入字幕文件');
    if (blocks.reduce((size, block) => size + block.text.length, 0) > 250000)
      throw new Error('材料过长，请分段导入');
    const contentHash = digest([url, blocks.map((block) => [block.text, block.seconds])]),
      existing = (await this.materials.list()).find(
        (material) =>
          material.contentHash === contentHash &&
          !material.deletedAt &&
          material.boardId === (request.boardId || null),
      );
    if (existing) return existing;
    const material = {
      id: randomUUID(),
      title,
      url,
      kind: ['article', 'video', 'text', 'pdf'].includes(request.kind)
        ? request.kind
        : blocks.some((block) => block.seconds != null)
          ? 'video'
          : 'text',
      publishedAt:
        typeof request.publishedAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(request.publishedAt) &&
        Number.isFinite(Date.parse(request.publishedAt))
          ? request.publishedAt
          : null,
      boardId: request.boardId || null,
      blocks,
      contentHash,
      completeness: request.completeness === 'partial' ? 'partial' : 'full',
      estimatedMinutes: readingMinutes(blocks),
      createdAt: new Date().toISOString(),
      latestPreviewId: null,
      deletedAt: null,
    };
    await this.materials.put(material.id, material);
    return material;
  }
}
