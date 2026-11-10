import { randomUUID } from 'node:crypto';
import { object, array, string, claimSchema, requiredText, optionalText, unique } from '../lib/values.js';
import { ANALYSIS_RULES, citedClaim, reportModelData } from '../reports.js';

const reviewSchema = object({
  prompt: string,
  answer: string,
  evidence: array(object({ sourceId: string, quote: string })),
});
const diagramSchema = object({
  title: string,
  kind: { type: 'string', enum: ['flow', 'hierarchy', 'comparison', 'cycle', 'timeline'] },
  nodes: array(object({ id: string, label: string, detail: string })),
  edges: array(object({ from: string, to: string, label: string })),
  caption: string,
});
export const TOPIC_SCHEMA = object({
  title: string,
  overview: claimSchema,
  points: array(object({ title: string, body: claimSchema })),
  agreements: array(claimSchema),
  differences: array(object({ title: string, views: array(claimSchema) })),
  gaps: array(object({ question: string, reason: string, sourceIds: array(string) })),
  changes: array(
    object({
      kind: { type: 'string', enum: ['added', 'changed', 'removed'] },
      description: string,
      sourceIds: array(string),
    }),
  ),
  diagram: diagramSchema,
  reviewQuestions: { ...array(reviewSchema), minItems: 1, maxItems: 8 },
});

export class TopicsModule {
  constructor(context) {
    Object.assign(this, context);
    this.id = 'topics';
  }
  register(router) {
    router.register('topics.list', () => this.list(), 'topics');
    router.register('topics.save', (request) => this.save(request), 'topics');
    router.register('topics.get', (request) => this.get(request.id), 'topics');
    router.register('topics.generate', (request) => this.generate(request), 'topics');
    router.register('topics.enroll', (request) => this.enroll(request), 'topics');
  }
  async list() {
    return (await this.topics.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(request) {
    const old = request.id ? await this.topics.get(request.id) : null,
      id = old?.id || randomUUID();
    const topic = {
      ...old,
      id,
      title: requiredText(request.title ?? old?.title, '专题名称', 120),
      description: optionalText(request.description ?? old?.description, 1800),
      noteIds: unique(request.noteIds ?? old?.noteIds ?? []).slice(0, 100),
      materialIds: unique(request.materialIds ?? old?.materialIds ?? []).slice(0, 100),
      deletedAt:
        request.deleted === true
          ? new Date().toISOString()
          : request.deleted === false
            ? null
            : old?.deletedAt || null,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestReportId: old?.latestReportId || null,
    };
    for (const noteId of topic.noteIds) await this.store.read(noteId);
    for (const materialId of topic.materialIds) await this.materials.get(materialId);
    await this.topics.put(id, topic);
    if (topic.deletedAt)
      for (const task of this.tasks.active())
        if (task.feature === 'topics' && task.key === id)
          await this.tasks.cancel(
            task.id,
            Object.assign(new Error('专题已删除'), { code: 'SOURCE_REMOVED' }),
          );
    return topic;
  }
  async get(id) {
    const topic = await this.topics.get(id),
      report = topic.latestReportId ? await this.reports.get(topic.latestReportId) : null,
      records = await this.sources.collect({ noteIds: topic.noteIds, materialIds: topic.materialIds });
    let usable = [];
    try {
      usable = this.sources.budget(records);
    } catch {
      /* Empty or unindexed picture-only topic. */
    }
    return {
      topic,
      report,
      needsUpdate: !!report && (!usable.length || report.fingerprint !== this.sources.fingerprint(usable)),
      sourceCount: usable.length,
    };
  }
  async enroll(request) {
    const report = await this.reports.get(request.reportId);
    if (report.feature !== 'topics' || report.unavailable) throw new Error('专题来源不可用');
    const question = report.value.reviewQuestions[request.index];
    if (!question) throw new Error('复习题不存在');
    const topic = await this.topics.get(report.key);
    return this.learning.enrollCustom({
      boardId: topic.noteIds[0] || null,
      summaryId: null,
      originFeature: 'topics',
      originTitle: topic.title,
      originId: report.id,
      index: request.index,
      question,
      sourceRefs: report.sources
        .map((source) => ({
          boardId: source.boardId,
          summaryId: source.summaryId,
          materialId: source.materialId,
        }))
        .filter((source) => source.boardId || source.materialId),
    });
  }
  async generate(request) {
    const topic = await this.topics.get(request.id);
    if (topic.deletedAt) throw new Error('请先恢复专题');
    const scope = { noteIds: topic.noteIds, materialIds: topic.materialIds },
      records = this.sources.budget(await this.sources.collect(scope)),
      previous = topic.latestReportId
        ? await this.reports.repository.get(topic.latestReportId, { optional: true })
        : null;
    return this.tasks.start({
      feature: 'topics',
      key: topic.id,
      title: '整理专题：' + topic.title,
      references: {
        noteIds: topic.noteIds,
        materialIds: topic.materialIds,
        summaryIds: unique(records.map((source) => source.summaryId).filter(Boolean)),
      },
      request: { id: topic.id, route: request.route },
      run: async (job) => {
        job.progress('正在串联专题主线、共识与分歧');
        const prior = previous?.value
          ? {
              overview: previous.value.overview.text,
              points: previous.value.points.map((point) => ({ title: point.title, text: point.body.text })),
            }
          : null;
        const prompt = [
          ANALYSIS_RULES,
          '整理专题：' + topic.title,
          '用户方向：' + topic.description,
          '通常保留 3～6 个推进主线的要点，正文约 600～1200 字。agreements 只写多份资料共同支持的结论；differences 展示不同解释、条件或立场，不强行消除分歧。gaps 只给真正值得补的 0～3 个问题。changes 对照上次结果突出新增、修正或不再支持的内容；没有上次结果时留空。diagram 有解释价值才绘制，否则 nodes/edges 为空；节点简短，最多 8 个，边只表达有依据的关系。上次结果仅用于比较，事实依据以本次资料为准。每次附 1～8 道核心复习题，数量按重要知识和联系决定，不凑满，不考无关细节与背景数字。',
          '上次结果：' + JSON.stringify(prior),
          '资料：' + reportModelData(records, this.sources),
          '输出结构：' + JSON.stringify(TOPIC_SCHEMA),
        ].join('\n');
        const result = await this.gateway.json({
          route: this.route('topics', request.route),
          prompt,
          schema: TOPIC_SCHEMA,
          signal: job.signal,
          progress: job.progress,
        });
        job.assertActive();
        const v = result.value;
        const value = {
          ...v,
          reviewQuestions: v.reviewQuestions.slice(0, 8).map((question) => ({
            ...question,
            evidence: this.sources.references(question.evidence, records),
          })),
          overview: citedClaim(v.overview, this.sources, records),
          points: v.points
            .slice(0, 8)
            .map((point) => ({ ...point, body: citedClaim(point.body, this.sources, records) })),
          agreements: v.agreements
            .map((claim) => citedClaim(claim, this.sources, records))
            .filter(
              (claim) =>
                new Set(
                  claim.evidence.map((source) =>
                    source.materialId ? 'm:' + source.materialId : source.boardId,
                  ),
                ).size > 1,
            ),
          differences: v.differences.slice(0, 4).map((item) => ({
            ...item,
            views: item.views.map((claim) => citedClaim(claim, this.sources, records)),
          })),
          gaps: v.gaps
            .slice(0, 3)
            .map((gap) => ({ ...gap, sources: this.sources.sourceIds(gap.sourceIds, records) })),
          changes: v.changes
            .slice(0, 8)
            .map((change) => ({ ...change, sources: this.sources.sourceIds(change.sourceIds, records) })),
        };
        value.diagram.nodes = value.diagram.nodes.slice(0, 8);
        const valid = new Set(value.diagram.nodes.map((node) => node.id));
        value.diagram.edges = value.diagram.edges.filter(
          (edge) => valid.has(edge.from) && valid.has(edge.to),
        );
        if ((await this.topics.get(topic.id)).deletedAt)
          throw Object.assign(new Error('专题已删除，未保存结果'), { code: 'SOURCE_REMOVED' });
        const report = await this.reports.save('topics', value, records, scope, result.model, {
          key: topic.id,
        });
        job.assertActive();
        await this.topics.update(topic.id, (current) => ({
          ...current,
          latestReportId: report.id,
          updatedAt: new Date().toISOString(),
        }));
        return { reportId: report.id, topicId: topic.id };
      },
    });
  }
}
