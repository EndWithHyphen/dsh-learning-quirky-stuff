import { lockDataDirectory } from './server/data-lock.js';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { LibraryStore } from './core.js';
import { SummaryJobs, availableModels } from './model.js';
import { LearningStore } from './learning.js';
import { GraphJobs } from './graph-ai.js';
import { CaptureServer } from './capture-server.js';
import { LearningRuntime } from './server/runtime.js';
import { executeStudyAction } from './server/service-actions.js';
import { Config, normalizeConfig } from './plugin-config.js';
export { Config };
export default class StudyboardService extends TypertRemoteService {
  static inject = ['llm', 'attachments', 'tools'];
  constructor(ctx, config = {}) {
    super(ctx, 'studyboard');
    config = normalizeConfig(config);
    this.store = new LibraryStore(config.dataDir || dshHomePath('storages', 'studyboard-v1'));
    this.learning = new LearningStore(this.store);
    this.capture = new CaptureServer(this.store, {
      port: config.capturePort,
    });
    this.runtime = new LearningRuntime(ctx, this.store, this.learning, {
      nativeOptions: { binaryPath: config.nativeReaderPath, allowCompile: config.allowNativeCompile },
    });
    this.capture.moduleAction = (request) => this.runtime.execute(request);
    this.ready = lockDataDirectory(this.store.root)
      .then((release) => {
        this.releaseDataLock = release;
        return this.store.init();
      })
      .then(() => this.learning.init())
      .then(() => this.runtime.init())
      .then(async () => {
        if (config.captureEnabled !== false) await this.capture.start();
      })
      .catch(async (error) => {
        await this.releaseDataLock?.();
        this.releaseDataLock = null;
        throw error;
      });
    this.ready.catch(() => {});
    this.jobs = new SummaryJobs(ctx, this.store, {
      infographicsEnabled: () => this.runtime.config.enabled('infographics'),
    });
    this.graphJobs = new GraphJobs(ctx, this.learning);
    for (const name of [
      'execute',
      'models',
      'startSummary',
      'summaryStatus',
      'cancelSummary',
      'captureInfo',
      'capturePairing',
    ])
      Remote(this[name], {
        kind: 'method',
        name,
        static: false,
        private: false,
        addInitializer: (fn) => fn.call(this),
      });
    ctx.effect(() => () => this.dispose());
    ctx.tools.register(
      defineTool({
        name: 'studyboard',
        description:
          '管理学习画板。request.action 支持 library、read、create、metadata、folder、duplicate、backup、setSummaryDeleted（删除/恢复指定 AI总结，提供 summaryId 与 deleted；不删除原画布）、annotate（原文批注）、enroll（把自测题加入复习）、reviewDashboard、graph（SPO 实体关系及原文依据）、linkConcepts、graphSettings（知识图谱模型偏好）、startGraphAi / graphAiStatus / cancelGraphAi（AI图谱整理任务）、suspendReview（不再出现或恢复复习卡）、purgeNotes（仅在用户明确确认后永久删除回收站笔记；提供 ids 数组和 confirm:true）。分类由用户自定义。新学习模块支持 features.get / features.update（独立功能开关与模型配置）、topics.list / topics.save / topics.get / topics.generate、explore.start / explore.queue、search.query / search.plan / search.index、materials.capture / materials.fetch / materials.preview、feedback.context / feedback.start，systemStudy.start / systemStudy.get / systemStudy.saveCanvas（系统学习与可编辑论证白板、时间旅行研究），weekly.overview / weekly.generate / weekly.get / weekly.reviewSession / weekly.grade（本周知识总结与复习），以及 tasks.get / tasks.cancel。信息图支持 infographics.list / infographics.get / infographics.start / infographics.saveCanvas / infographics.visibility（按内容配图、原生编辑、版本和来源）。耗时操作返回任务编号；来源引用保留原文定位。',
        parameters: { request: { type: 'json', required: true } },
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (args) => this.execute(args.request),
      }),
    );
  }
  async dispose() {
    await this.ready.catch(() => {});
    await Promise.allSettled([
      this.jobs.dispose(),
      this.graphJobs.dispose(),
      this.capture.close(),
      this.runtime.dispose(),
    ]);
    await this.releaseDataLock?.();
    this.releaseDataLock = null;
  }
  async execute(request) {
    await this.ready;
    return executeStudyAction(this, request);
  }
  async models() {
    return availableModels(this.ctx.llm, { refresh: true });
  }
  async startSummary(request) {
    await this.ready;
    return this.jobs.start(request);
  }
  async summaryStatus(id) {
    return this.jobs.get(id);
  }
  async cancelSummary(id) {
    return this.jobs.cancel(id);
  }
  async capturePairing(request) {
    await this.ready;
    if (request?.action === 'approve') return this.capture.connections.approve(request.id);
    if (request?.action === 'reject') return this.capture.connections.reject(request.id);
    if (request?.action === 'revoke') return this.capture.connections.revoke(request.id);
    throw new Error('浏览器连接操作不正确');
  }
  async captureInfo() {
    await this.ready;
    return this.capture.info();
  }
}
