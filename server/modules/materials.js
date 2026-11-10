import { randomUUID } from 'node:crypto';
import {
  object,
  array,
  string,
  claimSchema,
  digest,
  publicUrl,
  optionalText,
  requiredText,
} from '../lib/values.js';
import { splitParagraphs, parseSubtitles, readingMinutes } from '../../shared/material-text.js';
import { rankSources } from './search.js';
import { ANALYSIS_RULES, citedClaim, reportModelData } from '../reports.js';

export const PREVIEW_SCHEMA = object({
  question: string,
  overview: claimSchema,
  newPoints: array(claimSchema),
  alreadyRecorded: array(claimSchema),
  differences: array(claimSchema),
  readingPlan: array(object({ title: string, reason: string, sourceIds: array(string) })),
  limitations: string,
});
export class MaterialsModule {
  constructor(context) {
    Object.assign(this, context);
    this.id = 'preview';
  }
  register(router) {
    router.register('materials.list', () => this.list(), 'preview');
    router.register('materials.capture', (request) => this.capture(request), 'preview');
    router.register('materials.fetch', (request) => this.fetch(request), 'preview');
    router.register('materials.get', (request) => this.get(request.id), 'preview');
    router.register('materials.preview', (request) => this.preview(request), 'preview');
    router.register('materials.delete', (request) => this.delete(request), 'preview');
  }
  async list() {
    return (await this.materials.list())
      .filter((material) => !material.deletedAt)
      .map(({ blocks, ...value }) => ({ ...value, blockCount: blocks.length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async capture(request) {
    return this.materialLibrary.capture(request);
  }
  async fetch(request) {
    const url = publicUrl(requiredText(request.url, '网址', 10000));
    return this.tasks.start({
      feature: 'preview',
      key: 'url:' + url,
      title: '读取材料',
      request: { url },
      run: async (job) => {
        job.progress('正在读取文章正文');
        const document = await this.web.read(url, job.signal);
        job.assertActive();
        const material = await this.capture(document);
        return { materialId: material.id };
      },
    });
  }
  async get(id) {
    const material = await this.materials.get(id);
    if (material.deletedAt) throw new Error('材料已删除');
    return {
      material,
      report: material.latestPreviewId ? await this.reports.get(material.latestPreviewId) : null,
    };
  }
  async delete(request) {
    return this.materials.update(request.id, (material) => ({
      ...material,
      deletedAt: request.deleted === false ? null : new Date().toISOString(),
    }));
  }
  async preview(request) {
    const material = await this.materials.get(request.id);
    if (material.deletedAt) throw new Error('材料已删除');
    const fresh = (await this.sources.materialRecords(material.id)).map((source) => ({
        ...source,
        collection: 'new',
      })),
      library = await this.sources.collect(),
      existing = rankSources(
        material.title +
          ' ' +
          fresh
            .slice(0, 3)
            .map((source) => source.text.slice(0, 300))
            .join(' '),
        library,
        24,
      ).map((source) => ({ ...source, collection: 'existing' })),
      records = this.sources.budget([...fresh, ...existing], 55000),
      scope = {
        noteIds: [...new Set(existing.map((source) => source.boardId).filter(Boolean))],
        materialIds: [material.id],
      };
    return this.tasks.start({
      feature: 'preview',
      key: material.id,
      title: '预览：' + material.title,
      references: {
        noteIds: scope.noteIds,
        materialIds: [material.id],
        summaryIds: [...new Set(records.map((source) => source.summaryId).filter(Boolean))],
      },
      request: { id: material.id, route: request.route },
      run: async (job) => {
        job.progress('正在比较材料与已有笔记');
        const prompt = [
          ANALYSIS_RULES,
          '快速预览这份新材料，让用户知道它解决什么问题、相对已有笔记新增了什么、哪些部分值得细读。已有记录不等于用户已经掌握。newPoints 通常 2～5 条，必须引用新材料；alreadyRecorded 必须同时有新材料与旧笔记的证据，没有可比旧笔记时留空。differences 仅列有依据的差异，不凑数。readingPlan 最多 5 个位置，sourceIds 必须指向新材料段落；reason 说明读它能解决什么。简洁呈现，不逐段复述。',
          '新材料完整度：' + material.completeness + '，只有已提供部分可作依据。',
          '新材料编号：' +
            records
              .filter((source) => source.collection === 'new')
              .map((source) => source.ref)
              .join(','),
          '旧笔记编号：' +
            records
              .filter((source) => source.collection === 'existing')
              .map((source) => source.ref)
              .join(','),
          '资料：' + reportModelData(records, this.sources),
          '输出：' + JSON.stringify(PREVIEW_SCHEMA),
        ].join('\n');
        const result = await this.gateway.json({
            route: this.route('preview', request.route),
            prompt,
            schema: PREVIEW_SCHEMA,
            signal: job.signal,
            progress: job.progress,
          }),
          v = result.value;
        job.assertActive();
        const claim = (raw) => citedClaim(raw, this.sources, records),
          value = {
            ...v,
            overview: claim(v.overview),
            newPoints: v.newPoints
              .slice(0, 5)
              .map(claim)
              .filter((item) => item.evidence.some((source) => source.materialId === material.id)),
            alreadyRecorded: v.alreadyRecorded
              .slice(0, 5)
              .map(claim)
              .filter(
                (item) =>
                  item.evidence.some((source) => source.materialId === material.id) &&
                  item.evidence.some((source) => source.boardId && source.materialId !== material.id),
              ),
            differences: v.differences.slice(0, 4).map(claim),
            readingPlan: v.readingPlan
              .slice(0, 5)
              .map((step) => ({
                ...step,
                sources: this.sources
                  .sourceIds(step.sourceIds, records)
                  .filter((source) => source.materialId === material.id),
              }))
              .filter((step) => step.sources.length),
          };
        const report = await this.reports.save('preview', value, records, scope, result.model, {
          key: material.id,
        });
        job.assertActive();
        await this.materials.update(material.id, (current) => ({ ...current, latestPreviewId: report.id }));
        return { reportId: report.id, materialId: material.id };
      },
    });
  }
}
