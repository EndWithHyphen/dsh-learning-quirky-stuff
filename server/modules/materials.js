import { object, array, string, claimSchema, publicUrl, requiredText } from '../lib/values.js';
import { rankSources } from './search.js';
import { ANALYSIS_RULES, citedClaim, reportModelData } from '../reports.js';
import { generatePageStudy, pageStudyVersions, pageTemplateKey } from '../page-study.js';

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
    router.register('materials.studyUrl', (request) => this.fetch(request, true), 'preview');
    router.register('materials.study', (request) => this.study(request), 'preview');
    router.register('materials.enrollStudy', (request) => this.enrollStudy(request), 'preview');
    router.register('materials.get', (request) => this.get(request), 'preview');
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
  async fetch(request, study = false) {
    const url = publicUrl(requiredText(request.url, '网址', 10000));
    const route = this.route('preview', request.route);
    const template = study ? this.config.summaryTemplate(request.templateId) : null;
    return this.tasks.start({
      feature: 'preview',
      key: study
        ? 'study-url:' + JSON.stringify([url, route.provider, route.model, pageTemplateKey(template)])
        : 'url:' + url,
      title: study ? '网页学习总结' : '读取材料',
      request: { url, ...(study ? { templateId: template.id, templateRevision: template.revision } : {}) },
      run: async (job) => {
        job.progress('正在读取文章正文');
        const document = await this.web.read(url, job.signal);
        job.assertActive();
        const material = await this.capture(document);
        if (study) return generatePageStudy(this, material, route, job, template);
        return { materialId: material.id };
      },
    });
  }
  async get(request) {
    const material = await this.getMaterial(request);
    const studyId = request.studyId || material.latestStudyId;
    const studyReport = studyId ? await this.reports.get(studyId) : null;
    if (studyReport && (studyReport.kind !== 'pageStudy' || studyReport.key !== material.id))
      throw new Error('学习总结与材料不匹配');
    return {
      material,
      studyVersions: pageStudyVersions(material),
      report: material.latestPreviewId ? await this.reports.get(material.latestPreviewId) : null,
      studyReport,
    };
  }
  async getMaterial(request) {
    const material = await this.materials.get(request.id);
    if (material.deletedAt) throw new Error('材料已删除');
    if (
      request.boardId != null &&
      (material.boardId !== request.boardId || material.url !== publicUrl(request.url))
    )
      throw new Error('这份材料不属于当前网页笔记');
    return material;
  }
  async study(request) {
    const material = await this.getMaterial(request);
    const route = this.route('preview', request.route);
    const template = this.config.summaryTemplate(request.templateId);
    return this.tasks.start({
      feature: 'preview',
      key: 'study:' + JSON.stringify([material.id, route.provider, route.model, pageTemplateKey(template)]),
      title: '学习总结：' + material.title,
      references: { materialIds: [material.id], noteIds: material.boardId ? [material.boardId] : [] },
      request: {
        id: material.id,
        route: request.route,
        templateId: template.id,
        templateRevision: template.revision,
      },
      run: (job) => generatePageStudy(this, material, route, job, template),
    });
  }
  async enrollStudy(request) {
    const material = await this.getMaterial(request);
    const report = await this.reports.get(request.reportId);
    if (
      report.feature !== 'preview' ||
      report.kind !== 'pageStudy' ||
      report.key !== material.id ||
      report.unavailable ||
      report.stale
    )
      throw new Error('这份学习总结的来源已变化或不可用，请重新总结');
    let added = 0,
      suspended = 0;
    for (const [index, question] of report.value.reviewQuestions.entries()) {
      const result = await this.learning.enrollCustom({
        boardId: material.boardId,
        originFeature: 'preview',
        originId: report.id,
        originTitle: material.title,
        index,
        question: { ...question, kind: 'recall' },
        sourceRefs: question.evidence.map((s) => ({
          materialId: material.id,
          boardId: material.boardId,
          sourceId: s.id,
        })),
      });
      added += result.added;
      if (result.card.suspended) suspended++;
    }
    return { added, total: report.value.reviewQuestions.length, suspended };
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
