import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DefaultScheduler, Rating } from 'ts-fsrs';
import { atomicWrite, text } from './core.js';
import { legacyStudy, blockTexts, conceptKey } from './study-schema.js';
import { purgeNotes, resumePurges } from './trash.js';
import { buildGraphInput, currentGraph, graphReferenceSources } from './graph-data.js';

const now = () => new Date().toISOString();
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 20);
export class LearningStore {
  constructor(store) {
    this.store = store;
    this.file = join(store.root, 'learning.json');
  }
  async init() {
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('学习进度无法读取，原文件已保留');
      this.data = {
        version: 1,
        cards: {},
        links: [],
        settings: { retention: 0.9, dailyLimit: 20, reminderEnabled: false, reminderHour: 20 },
        reviews: [],
      };
    }
    if (this.data.version !== 1 || !this.data.cards || !Array.isArray(this.data.links))
      throw new Error('学习数据版本不支持');
    this.scheduler = await DefaultScheduler({
      desiredRetention: this.data.settings.retention,
      enableFuzz: false,
      maximumInterval: 3650,
    });
    await resumePurges(this);
    return this;
  }
  async commit(next) {
    await atomicWrite(this.file, next);
    this.data = JSON.parse(JSON.stringify(next));
  }
  async purge(r, options) {
    return purgeNotes(this, r, options);
  }
  async source(boardId, summaryId) {
    const b = await this.store.read(boardId);
    if (b.deletedAt) throw new Error('笔记已在回收站，请先恢复');
    const s = b.summaries.find((v) => v.id === summaryId);
    if (!s) throw new Error('找不到这次总结');
    if (s.deletedAt) throw Object.assign(new Error('这次总结已删除，请先恢复'), { code: 'SUMMARY_DELETED' });
    return { b, s, study: legacyStudy(s) };
  }
  async annotation(r) {
    return this.store.serial(async () => {
      const { b, s, study } = await this.source(r.id, r.summaryId),
        annotations = s.annotations || [];
      if (r.remove) {
        const next = annotations.filter((a) => a.id !== r.remove);
        if (next.length === annotations.length) throw new Error('批注已不存在');
        s.annotations = next;
      } else {
        const block = blockTexts(study)[r.blockId];
        if (typeof block !== 'string') throw new Error('批注段落不存在');
        const start = r.start ?? 0,
          end = r.end ?? start;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          end > block.length
        )
          throw new Error('批注位置不正确');
        const quote = block.slice(start, end);
        if (quote !== (r.quote || '')) throw new Error('选中文字已变化，请重新选择');
        if (!['highlight', 'underline', 'comment'].includes(r.kind)) throw new Error('批注类型不支持');
        if (start === end && !text(r.note, '', 6000)) throw new Error('请填写备注或选中文字');
        const existing = r.annotationId && annotations.find((a) => a.id === r.annotationId);
        if (r.annotationId && !existing) throw new Error('要编辑的批注已不存在');
        const value = {
          id: existing?.id || randomUUID(),
          blockId: r.blockId,
          start,
          end,
          quote,
          kind: r.kind,
          note: text(r.note, '', 6000),
          createdAt: existing?.createdAt || now(),
          updatedAt: now(),
        };
        if (annotations.length >= 500 && !existing) throw new Error('这次总结的批注已达到 500 条');
        s.annotations = existing
          ? annotations.map((a) => (a.id === existing.id ? value : a))
          : [...annotations, value];
      }
      b.updatedAt = now();
      await atomicWrite(this.store.boardPath(b.id), b);
      return { sId: s.id, annotations: s.annotations };
    });
  }
  async enroll(r) {
    return this.store.serial(async () => {
      const { b, s, study } = await this.source(r.id, r.summaryId);
      if (b.deletedAt) throw new Error('请先恢复笔记');
      const questions = r.questionId ? study.questions.filter((q) => q.id === r.questionId) : study.questions;
      if (!questions.length) throw new Error('没有可加入复习的问题');
      const next = structuredClone(this.data),
        date = new Date();
      let added = 0,
        suspended = 0;
      for (const q of questions) {
        const id = hash(`${b.id}/${s.id}/${q.id}`);
        if (next.cards[id]) {
          if (next.cards[id].suspended) suspended++;
          continue;
        }
        next.cards[id] = {
          id,
          boardId: b.id,
          summaryId: s.id,
          questionId: q.id,
          boardTitle: b.title,
          question: q.prompt,
          context: q.context || '',
          tasks: q.tasks || [],
          answer: q.answer,
          hint: q.hint,
          checkpoints: q.checkpoints || [],
          difficulty: q.difficulty || 'basic',
          kind: q.kind,
          conceptIds: q.conceptIds,
          createdAt: date.toISOString(),
          version: 0,
          suspended: false,
          schedule: this.scheduler.newCard({ now: date }),
        };
        added++;
      }
      await this.commit(next);
      return { added, total: questions.length, suspended };
    });
  }
  async enrollCustom(r) {
    return this.store.serial(async () => {
      const board = r.boardId
        ? await this.store.read(r.boardId)
        : { id: null, title: r.originTitle || '专题复习' };
      if (board.deletedAt) throw new Error('请先恢复笔记');
      if (r.summaryId) await this.source(r.boardId, r.summaryId);
      const id = hash(
        (r.boardId || 'artifact') + '/' + (r.originFeature || 'feedback') + '/' + r.originId + '/' + r.index,
      );
      if (this.data.cards[id]) return { added: 0, card: this.data.cards[id] };
      const next = structuredClone(this.data),
        date = new Date();
      next.cards[id] = {
        id,
        boardId: r.boardId,
        summaryId: r.summaryId || null,
        questionId: 'feedback:' + r.originId + ':' + r.index,
        boardTitle: r.originTitle || board.title,
        question: r.question.prompt,
        context:
          r.originFeature === 'topics'
            ? '串联专题中的核心知识与联系'
            : r.originFeature === 'systemStudy'
              ? '围绕系统学习的核心机制、条件和联系复习'
              : r.originFeature === 'weekly'
                ? r.question.context || '回忆这一周学习内容中的核心机制与联系'
                : '根据理解反馈巩固核心知识',
        tasks: r.question.tasks || [],
        answer: r.question.answer,
        hint: r.question.hint || '',
        checkpoints: r.question.checkpoints || [],
        kind: r.question.kind || 'explain',
        difficulty: r.question.difficulty || 'intermediate',
        conceptIds: [],
        origin: {
          feature: r.originFeature || 'feedback',
          id: r.originId,
          ...(Number.isInteger(r.index) ? { questionIndex: r.index } : {}),
        },
        sourceRefs: r.sourceRefs,
        createdAt: date.toISOString(),
        version: 0,
        suspended: false,
        schedule: this.scheduler.newCard({ now: date }),
      };
      await this.commit(next);
      return { added: 1, card: this.data.cards[id] };
    });
  }
  async validateCardSource(card) {
    if (card.origin && this.externalCardAvailable) {
      if (!(await this.externalCardAvailable(card))) throw new Error('复习来源已删除或不可用');
      return;
    }
    const references = [{ boardId: card.boardId, summaryId: card.summaryId }, ...(card.sourceRefs || [])];
    for (const ref of references) {
      if (ref.summaryId) await this.source(ref.boardId, ref.summaryId);
      else {
        const board = await this.store.read(ref.boardId);
        if (board.deletedAt) throw new Error('来源笔记已在回收站');
      }
    }
  }
  cardDates(card) {
    const c = structuredClone(card);
    for (const k of ['dueAt', 'lastReviewAt']) if (c[k]) c[k] = new Date(c[k]);
    return c;
  }
  async dashboard() {
    const { boards } = await this.store.all();
    const active = new Map(boards.filter((b) => !b.deletedAt).map((b) => [b.id, b]));
    const external = new Map();
    for (const card of Object.values(this.data.cards))
      if (card.origin && this.externalCardAvailable)
        external.set(card.id, await this.externalCardAvailable(card).catch(() => false));
    const hasSource = (c) =>
      external.has(c.id)
        ? external.get(c.id)
        : [{ boardId: c.boardId, summaryId: c.summaryId }, ...(c.sourceRefs || [])].every(
            (ref) =>
              active.has(ref.boardId) &&
              (!ref.summaryId ||
                active.get(ref.boardId).summaries.some((s) => s.id === ref.summaryId && !s.deletedAt)),
          );
    const cards = Object.values(this.data.cards).filter((c) => !c.suspended && hasSource(c));
    const date = new Date();
    const due = cards
      .filter((c) => new Date(c.schedule.dueAt) <= date)
      .sort((a, b) => new Date(a.schedule.dueAt) - new Date(b.schedule.dueAt));
    const today = date.toLocaleDateString('en-CA');
    const completed = this.data.reviews.filter(
      (r) => new Date(r.at).toLocaleDateString('en-CA') === today,
    ).length;
    return {
      dueCount: due.length,
      total: cards.length,
      completedToday: completed,
      dailyLimit: this.data.settings.dailyLimit,
      settings: this.data.settings,
      cards: due
        .slice(0, this.data.settings.dailyLimit)
        .map((c) => ({ ...c, boardTitle: active.get(c.boardId)?.title || c.boardTitle })),
      suspended: Object.values(this.data.cards)
        .filter((c) => c.suspended && hasSource(c))
        .map((c) => ({
          id: c.id,
          question: c.question,
          boardTitle: active.get(c.boardId)?.title || c.boardTitle,
          suspendedAt: c.suspendedAt || null,
        })),
      upcoming: cards
        .filter((c) => new Date(c.schedule.dueAt) > date)
        .sort((a, b) => new Date(a.schedule.dueAt) - new Date(b.schedule.dueAt))
        .slice(0, 15)
        .map((c) => ({ id: c.id, title: c.question, due: c.schedule.dueAt })),
      recentReviews: this.data.reviews.slice(-30).reverse(),
    };
  }
  async preview(r) {
    const c = this.data.cards[r.cardId];
    if (!c) throw new Error('复习卡不存在');
    await this.validateCardSource(c);
    return [...this.scheduler.preview({ card: this.cardDates(c.schedule), now: new Date() })].map((x) => ({
      grade: x.grade,
      due: new Date(x.card.dueAt).toISOString(),
    }));
  }
  async review(r) {
    return this.store.serial(async () => {
      const current = this.data.cards[r.cardId];
      if (!current) throw new Error('复习卡不存在');
      if (current.suspended) throw new Error('这张卡已设为不再出现，请刷新复习列表');
      await this.validateCardSource(current);
      if (typeof r.eventId !== 'string' || r.eventId.length > 100) throw new Error('复习操作编号不正确');
      const prior = this.data.reviews.find((v) => v.eventId === r.eventId);
      if (prior) return { card: current, duplicate: true };
      if (r.version !== current.version) throw new Error('这张卡已在其他窗口复习过，请刷新');
      if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(r.grade))
        throw new Error('请选择掌握程度');
      const date = new Date(),
        result = this.scheduler.review({ card: this.cardDates(current.schedule), grade: r.grade, now: date }),
        next = structuredClone(this.data);
      next.cards[r.cardId] = {
        ...current,
        version: current.version + 1,
        schedule: result.card,
        lastAnswer: text(r.answer, '', 8000),
        lastReviewedAt: date.toISOString(),
      };
      next.reviews.push({
        eventId: r.eventId,
        cardId: r.cardId,
        at: date.toISOString(),
        grade: r.grade,
        answer: text(r.answer, '', 8000),
        revlog: result.revlog,
      });
      await this.commit(next);
      return { card: this.data.cards[r.cardId], duplicate: false };
    });
  }
  async suspendReview(r) {
    return this.store.serial(async () => {
      const current = this.data.cards[r.cardId];
      if (!current || typeof r.suspended !== 'boolean') throw new Error('复习卡或操作不正确');
      if (!!current.suspended === r.suspended) return { card: current };
      const next = structuredClone(this.data);
      next.cards[r.cardId] = {
        ...current,
        suspended: r.suspended,
        suspendedAt: r.suspended ? now() : null,
        version: current.version + 1,
      };
      await this.commit(next);
      return { card: this.data.cards[r.cardId] };
    });
  }
  async settings(r) {
    return this.store.serial(async () => {
      const next = structuredClone(this.data),
        s = next.settings;
      if ('retention' in r) {
        if (!Number.isFinite(r.retention) || r.retention < 0.8 || r.retention > 0.97)
          throw new Error('记忆目标应在 80% 到 97% 之间');
        s.retention = r.retention;
      }
      if ('dailyLimit' in r) {
        if (!Number.isInteger(r.dailyLimit) || r.dailyLimit < 1 || r.dailyLimit > 200)
          throw new Error('每日上限为 1～200 张');
        s.dailyLimit = r.dailyLimit;
      }
      if ('reminderEnabled' in r) s.reminderEnabled = !!r.reminderEnabled;
      if ('reminderHour' in r) {
        if (!Number.isInteger(r.reminderHour) || r.reminderHour < 0 || r.reminderHour > 23)
          throw new Error('提醒时间不正确');
        s.reminderHour = r.reminderHour;
      }
      await this.commit(next);
      this.scheduler = await DefaultScheduler({
        desiredRetention: s.retention,
        enableFuzz: false,
        maximumInterval: 3650,
      });
      return s;
    });
  }
  async graph({ includeHistory = this.data.graphSettings?.includeHistory === true } = {}) {
    const { boards } = await this.store.all(),
      input = buildGraphInput(boards, { includeHistory }),
      report = this.data.graphReport || null,
      { enabled: _legacyEnabled, ...settings } = this.data.graphSettings || {
        provider: '',
        model: '',
        includeHistory: false,
      },
      current = currentGraph(report, input, this.data.links, graphReferenceSources(boards, report)),
      stale =
        !!report &&
        (report.fingerprint !== input.fingerprint || (report.focus || '') !== (settings.focus || ''));
    const safeReport = report
      ? {
          id: report.id,
          schemaVersion: report.schemaVersion || 1,
          createdAt: report.createdAt || null,
          provider: report.provider || null,
          model: report.model || null,
          reasoningEffort: report.reasoningEffort || null,
          overview: current.invalidSourceCount ? '' : report.overview || '',
          coverage: report.coverage || input.coverage,
        }
      : null;
    return {
      ...current,
      fingerprint: input.fingerprint,
      coverage: input.coverage,
      includeHistory,
      aiSettings: settings,
      aiReport: safeReport,
      aiStale: stale,
    };
  }

  async graphSettings(r) {
    return this.store.serial(async () => {
      const next = structuredClone(this.data),
        settings = next.graphSettings || { provider: '', model: '' };
      delete settings.enabled;
      if ('includeHistory' in r) settings.includeHistory = !!r.includeHistory;
      if ('provider' in r) settings.provider = text(r.provider, '', 200);
      if ('model' in r) settings.model = text(r.model, '', 200);
      if ('focus' in r) settings.focus = text(r.focus, '', 600);
      next.graphSettings = settings;
      await this.commit(next);
      return settings;
    });
  }
  async saveGraphReport(report, signal) {
    return this.store.serial(async () => {
      signal?.throwIfAborted();
      const next = structuredClone(this.data);
      next.graphReport = report;
      await this.commit(next);
      return report;
    });
  }
  async link(r) {
    const graph = await this.graph();
    return this.store.serial(async () => {
      const next = structuredClone(this.data);
      if (r.remove) next.links = next.links.filter((l) => l.id !== r.remove);
      else {
        if (
          r.from === r.to ||
          !graph.nodes.some((n) => n.id === r.from) ||
          !graph.nodes.some((n) => n.id === r.to)
        )
          throw new Error('请选择两个不同的知识点');
        const label = text(r.label, '', 80);
        if (!label) throw new Error('请填写明确的关系，例如支持、主张或依赖');
        if (!next.links.some((l) => l.from === r.from && l.to === r.to && l.label === label))
          next.links.push({ id: randomUUID(), from: r.from, to: r.to, label });
      }
      await this.commit(next);
      return { ok: true };
    });
  }
  async dispatch(r) {
    switch (r.action) {
      case 'purgeNotes':
        return this.purge(r);
      case 'suspendReview':
        return this.suspendReview(r);
      case 'graphSettings':
        return this.graphSettings(r);
      case 'backup':
        return { ...(await this.store.backup()), learning: structuredClone(this.data) };
      case 'annotate':
        return this.annotation(r);
      case 'enroll':
        return this.enroll(r);
      case 'reviewDashboard':
        return this.dashboard();
      case 'reviewPreview':
        return this.preview(r);
      case 'review':
        return this.review(r);
      case 'learningSettings':
        return this.settings(r);
      case 'graph':
        return this.graph();
      case 'linkConcepts':
        return this.link(r);
      default:
        return this.store.dispatch(r);
    }
  }
}
