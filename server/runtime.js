import { FeatureConfig } from './config.js';
import { TaskManager } from './task-manager.js';
import { ActionRouter } from './action-router.js';
import { JsonRepository } from './lib/storage.js';
import { findCodex } from '../codex-provider.js';
import { cancelled, unique } from './lib/values.js';
import { availableModels } from './ai/catalog.js';
import { ModelGateway } from './ai/gateway.js';
import { NativeReader } from './integrations/native-reader.js';
import { WebReader } from './integrations/web-reader.js';
import { SourceRepository } from './sources.js';
import { MaterialLibrary } from './material-library.js';
import { ReportStore } from './reports.js';
import { TopicsModule } from './modules/topics.js';
import { ExploreModule } from './modules/explore.js';
import { SearchModule } from './modules/search.js';
import { MaterialsModule } from './modules/materials.js';
import { FeedbackModule } from './modules/feedback.js';
import { SystemStudyModule } from './modules/system-study.js';
import { WeeklyModule } from './modules/weekly.js';
import { InfographicsModule } from './modules/infographics.js';
import { weeklyCardAvailable } from './weekly-review.js';
import { CanvasCommentsModule } from './modules/canvas-comments.js';

/** Composition root: modules receive shared services and register their own actions. */
export class LearningRuntime {
  constructor(ctx, store, learning, overrides = {}) {
    this.store = store;
    this.learning = learning;
    this.config = new FeatureConfig(store.root);
    this.tasks = new TaskManager(store.root, this.config, overrides.tasks);
    this.router = new ActionRouter(this.config);
    this.repositories = Object.fromEntries(
      [
        'topics',
        'materials',
        'search-index',
        'reports',
        'queue',
        'study-canvases',
        'infographics',
        'infographic-canvases',
        'canvas-comments',
      ].map((name) => [name, new JsonRepository(store.root, name)]),
    );
    this.sources = new SourceRepository(
      store,
      this.repositories.materials,
      this.repositories['search-index'],
    );
    this.sources.reportRepository = this.repositories.reports;
    this.sources.learning = learning;
    this.sources.canvasRepository = this.repositories['study-canvases'];
    this.sources.topicRepository = this.repositories.topics;
    this.native = overrides.native || new NativeReader(store.root, overrides.nativeOptions);
    this.web = overrides.web || new WebReader(this.native);
    this.gateway = overrides.gateway || new ModelGateway(ctx);
    this.reports = new ReportStore(this.repositories.reports, this.sources);
    learning.externalCardAvailable = async (card) => {
      if (card.origin.feature === 'weekly') return weeklyCardAvailable(card, this);
      const report = await this.reports.get(card.origin.id);
      if (report.unavailable) return false;
      if (report.feature === 'topics') {
        const topic = await this.repositories.topics.get(report.key, { optional: true });
        if (!topic || topic.deletedAt) return false;
      }
      return true;
    };
    const materialLibrary = new MaterialLibrary(store, this.repositories.materials);
    const context = {
      store,
      learning,
      config: this.config,
      tasks: this.tasks,
      sources: this.sources,
      native: this.native,
      web: this.web,
      gateway: this.gateway,
      reports: this.reports,
      topics: this.repositories.topics,
      materials: this.repositories.materials,
      index: this.repositories['search-index'],
      queue: this.repositories.queue,
      studyCanvases: this.repositories['study-canvases'],
      infographics: this.repositories.infographics,
      infographicCanvases: this.repositories['infographic-canvases'],
      comments: this.repositories['canvas-comments'],
      materialLibrary,
      route: (feature, route) => (route?.provider ? route : this.config.get().models[feature] || {}),
    };
    this.modules = [
      new TopicsModule(context),
      new ExploreModule(context),
      new SearchModule(context),
      new MaterialsModule(context),
      new FeedbackModule(context),
      new SystemStudyModule(context),
      new WeeklyModule(context),
      new InfographicsModule(context),
      new CanvasCommentsModule(context),
    ];
    for (const module of this.modules) module.register(this.router);
    this.router.register('features.get', () => this.config.get());
    this.router.register('system.capabilities', async () => {
      const native = this.native.availability ? await this.native.availability() : { available: true };
      const { path, ...safeNative } = native;
      return {
        platform: process.platform,
        ocr: safeNative,
        pdf: safeNative,
        codex: { available: !!(await findCodex()) },
      };
    });
    this.router.register('features.models', () => availableModels(ctx.llm));
    this.router.register('features.update', (request) => this.updateConfig(request));
    this.router.register('tasks.get', (request) => this.tasks.get(request.id));
    this.router.register('tasks.list', (request) => this.tasks.list(request.feature));
    this.router.register('tasks.cancel', (request) => this.tasks.cancel(request.id));
    this.router.register('reports.get', async (request) => {
      const report = await this.reports.get(request.id);
      this.config.assert(report.feature);
      return report;
    });
    this.router.register('sources.catalog', () => this.catalog());
    this.router.register('sources.get', (request) => this.source(request.id));
  }
  async init() {
    await this.config.init();
    for (const repository of Object.values(this.repositories)) await repository.init();
    await this.tasks.init();
    if (this.store.purged.size) await this.purge([...this.store.purged]);
    return this;
  }
  has(action) {
    return this.router.has(action);
  }
  execute(request) {
    return this.router.execute(request);
  }
  async updateConfig(request) {
    const settings = await this.config.update(request);
    for (const job of this.tasks.active())
      if (!settings.features[job.feature] && ['queued', 'running'].includes(job.status))
        await this.tasks.cancel(job.id, cancelled('功能已关闭，任务已停止', 'FEATURE_DISABLED'));
    return settings;
  }
  async catalog() {
    const library = await this.store.library(),
      materials = (await this.repositories.materials.list())
        .filter((material) => !material.deletedAt)
        .map(({ blocks, ...material }) => ({ ...material, blockCount: blocks.length }));
    return { notes: library.boards.filter((note) => !note.deletedAt), materials };
  }
  async source(id) {
    if (typeof id !== 'string') throw new Error('来源编号不正确');
    const parts = id.split('/');
    const records =
        parts[0] === 'review'
          ? await this.sources.reviewRecords()
          : parts[0] === 'report'
            ? await this.sources.reportRecords(parts[1])
            : parts[0] === 'material'
              ? await this.sources.materialRecords(parts[1])
              : await this.sources.noteRecords(parts[0], { allSummaries: true }),
      source = records.find((source) => source.id === id);
    if (!source) throw new Error('来源已删除或变化');
    let image = null;
    if (source.kind === 'image') {
      const board = await this.sources.note(source.boardId),
        element = board.scene.elements.find(
          (element) => element.id === source.locator.elementIds[0] && !element.isDeleted,
        );
      image = (element && board.scene.files[element.fileId]?.dataURL) || null;
    }
    return { source, image };
  }
  async summaryDeleted(summaryId) {
    for (const job of this.tasks.active())
      if (job.references.summaryIds?.includes(summaryId) && ['queued', 'running'].includes(job.status))
        await this.tasks.cancel(job.id, cancelled('来源总结已删除', 'SOURCE_REMOVED'));
  }
  async noteDeleted(id) {
    for (const job of this.tasks.active())
      if (job.references.noteIds?.includes(id) && ['queued', 'running'].includes(job.status))
        await this.tasks.cancel(job.id, cancelled('来源笔记已移入回收站', 'SOURCE_REMOVED'));
  }
  async beforePurge(ids) {
    await this.tasks.cancelWhere(
      (record) => record.references.noteIds?.some((id) => ids.includes(id)),
      cancelled('来源笔记已永久删除', 'SOURCE_REMOVED'),
    );
  }
  async purge(ids) {
    await this.tasks.removeReferences(ids);
    for (const repository of [
      this.repositories.infographics,
      this.repositories['infographic-canvases'],
      this.repositories['canvas-comments'],
    ])
      for (const entry of await repository.list())
        if (ids.includes(entry.noteId)) await repository.remove(entry.id);
    const materials = await this.repositories.materials.list(),
      removedMaterials = new Set(
        materials.filter((material) => ids.includes(material.boardId)).map((material) => material.id),
      );
    for (const materialId of removedMaterials) await this.repositories.materials.remove(materialId);
    const removedReports = new Set();
    for (const report of await this.repositories.reports.list())
      if (
        report.sources.some(
          (source) => ids.includes(source.boardId) || removedMaterials.has(source.materialId),
        )
      ) {
        await this.repositories.reports.remove(report.id);
        removedReports.add(report.id);
      }
    let removedDependants = true;
    while (removedDependants) {
      removedDependants = false;
      for (const report of await this.repositories.reports.list())
        if (report.sources.some((source) => removedReports.has(source.reportId))) {
          await this.repositories.reports.remove(report.id);
          removedReports.add(report.id);
          removedDependants = true;
        }
    }
    for (const material of await this.repositories.materials.list())
      if (removedReports.has(material.latestPreviewId))
        await this.repositories.materials.put(material.id, { ...material, latestPreviewId: null });
    for (const canvas of await this.repositories['study-canvases'].list())
      if (removedReports.has(canvas.id) || ids.includes(canvas.noteId))
        await this.repositories['study-canvases'].remove(canvas.id);
    for (const topic of await this.repositories.topics.list())
      if (
        topic.noteIds.some((id) => ids.includes(id)) ||
        topic.materialIds.some((id) => removedMaterials.has(id)) ||
        removedReports.has(topic.latestReportId)
      )
        await this.repositories.topics.put(topic.id, {
          ...topic,
          noteIds: topic.noteIds.filter((id) => !ids.includes(id)),
          materialIds: topic.materialIds.filter((id) => !removedMaterials.has(id)),
          latestReportId: removedReports.has(topic.latestReportId) ? null : topic.latestReportId,
        });
    for (const entry of await this.repositories.queue.list())
      if (
        removedReports.has(entry.reportId) ||
        entry.sources.some(
          (source) => ids.includes(source.boardId) || removedMaterials.has(source.materialId),
        )
      )
        await this.repositories.queue.remove(entry.id);
    for (const id of ids) {
      await this.repositories['search-index'].remove(id);
      this.sources.cache.delete(id);
      for (const key of this.sources.recordCache.keys())
        if (key.startsWith(id + ':')) this.sources.recordCache.delete(key);
    }
  }
  async backup() {
    return {
      settings: this.config.get(),
      topics: await this.repositories.topics.list(),
      materials: await this.repositories.materials.list(),
      reports: await this.repositories.reports.list(),
      queue: await this.repositories.queue.list(),
      searchIndex: await this.repositories['search-index'].list(),
      studyCanvases: await this.repositories['study-canvases'].list(),
      infographics: await this.repositories.infographics.list(),
      infographicCanvases: await this.repositories['infographic-canvases'].list(),
      canvasComments: await this.repositories['canvas-comments'].list(),
    };
  }
  async dispose() {
    await this.tasks.dispose();
  }
}
