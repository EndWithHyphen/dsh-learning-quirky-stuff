import {
  object,
  array,
  string,
  claimSchema,
  evidenceSchema,
  unique,
  normalized,
  optionalText,
} from '../lib/values.js';
import { ANALYSIS_RULES, citedClaim } from '../reports.js';
import { weeklyPeriod, inWeek } from '../weekly-period.js';
import { weeklyReviewReferences } from '../weekly-review.js';

export const WEEKLY_SCHEMA = object({
  title: string,
  overview: claimSchema,
  knowledgeSummary: object({
    mainline: claimSchema,
    points: { ...array(object({ title: string, explanation: claimSchema })), minItems: 1, maxItems: 6 },
  }),
  reviewQuestions: {
    ...array(
      object({
        kind: { type: 'string', enum: ['recall', 'explain', 'apply'] },
        prompt: string,
        context: string,
        tasks: { ...array(string), maxItems: 4 },
        answer: string,
        hint: string,
        checkpoints: { ...array(string), maxItems: 5 },
        evidence: evidenceSchema,
      }),
    ),
    minItems: 1,
    maxItems: 8,
  },
  themes: { ...array(object({ title: string, progress: claimSchema })), maxItems: 6 },
  changes: { ...array(claimSchema), maxItems: 4 },
  connections: { ...array(claimSchema), maxItems: 3 },
  nextWeek: { ...array(object({ focus: string, reason: claimSchema })), maxItems: 3 },
});
const countedFeatures = new Set(['systemStudy', 'topics', 'explore', 'preview', 'feedback']);
export class WeeklyModule {
  constructor(context) {
    Object.assign(this, context);
    this.id = 'weekly';
  }
  register(router) {
    for (const [action, method] of Object.entries({
      overview: 'overview',
      generate: 'generate',
      list: 'list',
      get: 'get',
      deleted: 'deleted',
      reviewSession: 'reviewSession',
      enroll: 'enroll',
      grade: 'grade',
    }))
      router.register('weekly.' + action, (request) => this[method](request), this.id);
  }
  async list() {
    return (await this.reports.repository.list())
      .filter((r) => r.feature === this.id)
      .map((r) => ({
        id: r.id,
        key: r.key,
        title: r.value.title,
        week: r.value.week,
        createdAt: r.createdAt,
        deletedAt: r.deletedAt || null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get({ id }) {
    const report = await this.reports.get(id);
    if (report.feature !== this.id) throw new Error('这不是学习周报');
    return report;
  }
  async deleted({ id, deleted }) {
    await this.get({ id });
    if (typeof deleted !== 'boolean') throw new Error('删除状态不正确');
    await this.reports.repository.update(id, (r) => ({
      ...r,
      deletedAt: deleted ? new Date().toISOString() : null,
    }));
    return { id, deleted };
  }
  async reviewSession({ id }) {
    const report = await this.get({ id });
    if (report.unavailable) throw new Error('这份周报的来源已不可用，请恢复来源后复习');
    const cards = Object.values(this.learning.data.cards).filter(
      (card) => card.origin?.feature === 'weekly' && card.origin.id === id,
    );
    return {
      questions: (report.value.reviewQuestions || []).map((question, index) => {
        const card = cards.find((card) => card.origin.questionIndex === index);
        return {
          index,
          question,
          card: card
            ? {
                id: card.id,
                version: card.version,
                suspended: card.suspended,
                due: card.schedule.dueAt,
                lastReviewedAt: card.lastReviewedAt || null,
              }
            : null,
        };
      }),
    };
  }
  async enroll({ id, index }) {
    const report = await this.get({ id });
    if (report.unavailable) throw new Error('这份周报的来源已不可用，请恢复来源后复习');
    const question = Number.isInteger(index) && report.value.reviewQuestions?.[index];
    if (!question) throw new Error('这份周报没有对应的复习题，可以重新生成本周总结');
    return this.learning.enrollCustom({
      boardId: question.evidence.find((source) => source.boardId)?.boardId || report.scope.noteIds[0] || null,
      summaryId: null,
      originFeature: 'weekly',
      originTitle: report.value.title,
      originId: id,
      index,
      question,
      sourceRefs: weeklyReviewReferences(report, this.learning),
    });
  }
  async grade(request) {
    if (
      ![1, 2, 3, 4].includes(request.grade) ||
      !Number.isInteger(request.version) ||
      request.version < 0 ||
      typeof request.eventId !== 'string' ||
      !request.eventId ||
      request.eventId.length > 100
    )
      throw new Error('复习记录不完整，请重新打开本周复习');
    const { card } = await this.enroll(request);
    if (card.suspended) throw new Error('这张卡已设为不再出现，可在今日复习设置中恢复');
    return this.learning.review({
      cardId: card.id,
      version: request.version,
      grade: request.grade,
      answer: optionalText(request.answer, 8000),
      eventId: request.eventId,
    });
  }
  async overview(request) {
    const { records, scope, ...overview } = await this.snapshot(request);
    return { ...overview, sourceCount: records.length };
  }
  async snapshot(request) {
    const week = weeklyPeriod(request.date, request.timeZone),
      { boards, errors } = await this.store.all(),
      notes = boards.filter((b) => !b.deletedAt),
      summaries = notes.flatMap((b) =>
        b.summaries
          .filter((s) => !s.deletedAt && inWeek(s.createdAt, week))
          .map((s) => ({ note: b, summary: s })),
      ),
      summaryIds = new Set(summaries.map((x) => x.summary.id)),
      reportItems = [];
    const editedCanvases = new Map(
      (await this.studyCanvases.list())
        .filter((canvas) => inWeek(canvas.updatedAt, week))
        .map((canvas) => [canvas.id, canvas]),
    );
    for (const report of await this.reports.repository.list()) {
      if (
        !countedFeatures.has(report.feature) ||
        report.deletedAt ||
        (!inWeek(report.createdAt, week) && !editedCanvases.has(report.id))
      )
        continue;
      const checked = await this.reports.get(report.id);
      if (!checked.unavailable) reportItems.push(checked);
    }
    const reviewRecords = await this.sources.reviewRecords(
      this.learning.data.reviews.filter((event) => inWeek(event.at, week)).map((event) => event.eventId),
    );
    const selectedReviews = reviewRecords.filter((r) => inWeek(r.reviewedAt, week));
    const logs = this.learning.data.reviews.filter((event) => inWeek(event.at, week));
    const newNotes = notes.filter((n) => inWeek(n.createdAt, week)),
      changedNotes = notes.filter((n) => inWeek(n.updatedAt, week));
    const noteIds = unique(
      [...newNotes, ...changedNotes, ...summaries.map((x) => x.note)]
        .map((n) => n.id)
        .concat(
          selectedReviews.map((r) => r.boardId).filter(Boolean),
          reportItems.flatMap((r) => r.scope.noteIds || []),
        ),
    );
    const scope = {
      noteIds,
      materialIds: [],
      reportIds: reportItems.map((r) => r.id),
      reviewIds: selectedReviews.map((r) => r.reviewId),
    };
    const current = await this.sources.collect({ ...scope, allSummaries: true });
    const changed = new Set(changedNotes.map((n) => n.id)),
      reportIds = new Set(
        reportItems.filter((report) => inWeek(report.createdAt, week)).map((report) => report.id),
      );
    const editedIds = new Set(
      current
        .filter((source) => source.kind === 'learning-edit' && inWeek(source.recordedAt, week))
        .map((source) => source.reportId),
    );
    const annotationIds = new Set(
      notes.flatMap((note) =>
        note.summaries.flatMap((summary) =>
          (summary.annotations || [])
            .filter((a) => inWeek(a.updatedAt || a.createdAt, week))
            .map((a) => note.id + '/' + summary.id + '/annotation-' + a.id),
        ),
      ),
    );
    let records = current.filter(
      (source) =>
        source.kind === 'review' ||
        (source.kind === 'learning-edit'
          ? editedIds.has(source.reportId)
          : source.reportId && reportIds.has(source.reportId)) ||
        (source.kind === 'annotation'
          ? annotationIds.has(source.id)
          : source.summaryId
            ? summaryIds.has(source.summaryId)
            : changed.has(source.boardId) &&
              ['notes', 'canvas', 'image', 'handwriting'].includes(source.kind)),
    );
    try {
      records = this.sources.budget(records, 45000);
    } catch {
      records = [];
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: week.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const stats = {
      newNotes: newNotes.length,
      summaries: summaries.length,
      analyses: reportItems.filter((report) => inWeek(report.createdAt, week)).length,
      reviews: logs.length,
      reviewCards: new Set(logs.map((r) => r.cardId)).size,
      reviewDays: new Set(logs.map((r) => formatter.format(new Date(r.at)))).size,
      ratings: {
        again: logs.filter((r) => r.grade === 1).length,
        hard: logs.filter((r) => r.grade === 2).length,
        good: logs.filter((r) => r.grade === 3).length,
        easy: logs.filter((r) => r.grade === 4).length,
      },
    };
    const activities = [
      ...newNotes.map((n) => ({ kind: 'note', title: n.title, at: n.createdAt, boardId: n.id })),
      ...summaries.map(({ note, summary }) => ({
        kind: 'summary',
        title: summary.study?.title || note.title,
        at: summary.createdAt,
        boardId: note.id,
        summaryId: summary.id,
      })),
      ...reportItems
        .filter((r) => inWeek(r.createdAt, week))
        .map((r) => ({
          kind: r.feature,
          title: r.value.title || r.value.focus || r.value.promptQuestion || '学习整理',
          at: r.createdAt,
          reportId: r.id,
          feature: r.feature,
          boardId: r.scope.noteIds?.[0] || null,
        })),
      ...reportItems
        .filter((r) => editedIds.has(r.id))
        .map((r) => ({
          kind: 'studyEdit',
          title: r.value.title,
          at: editedCanvases.get(r.id).updatedAt,
          reportId: r.id,
          feature: r.feature,
          boardId: r.key,
        })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 40);
    return {
      week,
      stats,
      activities,
      records,
      scope,
      incompleteNotes: errors.length,
      note: '统计来自已保存记录；复习评级是你的自评。系统没有记录阅读时长或全部阅读行为，笔记正文为当前可用版本。',
    };
  }
  async generate(request) {
    const snapshot = await this.snapshot(request);
    if (!snapshot.records.length) throw new Error('这一周还没有可用于回顾的正文、总结或复习记录');
    const { records, scope, week, stats } = snapshot;
    return this.tasks.start({
      feature: this.id,
      key: week.key,
      title: '学习周报：' + week.startDate + ' 至 ' + week.endDate,
      references: {
        noteIds: scope.noteIds,
        summaryIds: unique(records.map((r) => r.summaryId).filter(Boolean)),
        reportIds: scope.reportIds,
      },
      request: { date: week.startDate, timeZone: week.timeZone },
      run: async (job) => {
        job.progress('正在串联本周主题、理解变化与复习记录');
        const result = await this.gateway.json({
          route: this.route(this.id, request.route),
          schema: WEEKLY_SCHEMA,
          signal: job.signal,
          maxTokens: 6500,
          progress: job.progress,
          prompt: [
            ANALYSIS_RULES,
            '生成一份有用而克制的学习周报，围绕这周推进的主题组织。通常保留 2～4 个值得记住的进展；资料少时减少内容。避免流水账、空泛夸奖、凭空设定学习时长和掌握率。识别同一主题上的实际推进与重复整理，重复生成不能当成新的学习进步。',
            'knowledgeSummary 是本周知识总结：mainline 串起重要问题、概念和机制；points 提炼能带走的解释、适用条件及跨笔记联系。总结具体学到的内容，不能只复述“这周做了什么”。主题不相关时保留各自主线，不强行拼接。正文精练，每项解释有原文依据。',
            'reviewQuestions 每次生成 1～8 道核心复习题，题量按本周的重要知识决定，不凑满。优先检验机制、条件和迁移，避免琐碎日期与无关数字。复杂题在 context 写清条件、tasks 拆解作答任务，checkpoints 给核对要点；简单题允许这些字段为空。每题有参考答案和可核对依据。review 类型来源中，“我的作答”可能有误，只有明确标注的“参考答案（来自已保存复习卡）”可作为答案依据。',
            'themes.progress 说明本周记录把哪个问题推进到了哪里。changes 只能依据具体作答、批注、反馈或可比较的前后记录说明理解变化；仅有 AI 总结不能推断用户已掌握，没有依据就留空。connections 只写有真实来源支撑的跨笔记联系，不强行串联。nextWeek 最多三个具体重点，说明为何值得继续；不要自动创建计划或任务。',
            '复习的 Again/Hard/Good/Easy 是用户自评，不能换算成客观正确率。生成过、读过、能独立解释是不同事情。笔记正文只能视为当前可用记录，不能推断其每段内容是在该周首次学会。旧周的活动记录可能不完整，不臆造补齐。',
            '本周范围与统计（只读，数字由系统统计）：' + JSON.stringify({ week, stats }),
            '资料：' + JSON.stringify(this.sources.modelData(records)),
            '输出：' + JSON.stringify(WEEKLY_SCHEMA),
          ].join('\n'),
        });
        job.assertActive();
        const v = result.value,
          claim = (c) => citedClaim(c, this.sources, records);
        if (!v.knowledgeSummary?.points?.length || !v.reviewQuestions?.length || v.reviewQuestions.length > 8)
          throw new Error('模型遗漏了知识总结或有效复习题，请重试');
        const reviewQuestions = v.reviewQuestions.map((question) => {
          if (!question.prompt?.trim() || !question.answer?.trim())
            throw new Error('模型返回了空的复习题，请重试');
          const evidence = this.sources.references(question.evidence, records);
          if (
            evidence.some(
              (source) =>
                source.kind === 'review' &&
                (!source.referenceAnswer ||
                  !normalized(source.referenceAnswer).includes(normalized(source.quote))),
            )
          )
            throw new Error('复习答案不能只依据用户作答或自评，请重新生成');
          return { ...question, evidence };
        });
        const value = {
          title: v.title,
          week,
          stats,
          overview: claim(v.overview),
          knowledgeSummary: {
            mainline: claim(v.knowledgeSummary.mainline),
            points: v.knowledgeSummary.points
              .slice(0, 6)
              .map((point) => ({ title: point.title, explanation: claim(point.explanation) })),
          },
          reviewQuestions,
          themes: v.themes.slice(0, 6).map((x) => ({ title: x.title, progress: claim(x.progress) })),
          changes: v.changes.slice(0, 4).map(claim),
          connections: v.connections.slice(0, 3).map(claim),
          nextWeek: v.nextWeek.slice(0, 3).map((x) => ({ focus: x.focus, reason: claim(x.reason) })),
          note: snapshot.note,
        };
        const report = await this.reports.save(this.id, value, records, scope, result.model, {
          key: week.key,
        });
        job.assertActive();
        return { reportId: report.id };
      },
    });
  }
}
