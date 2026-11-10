import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite } from './core.js';
import { STUDY_SCHEMA, parseStudy, studyText, legacyStudy } from './study-schema.js';
import { findCodex, runCodex } from './codex-provider.js';
import { availableModels } from './server/ai/catalog.js';
import { ModelGateway } from './server/ai/gateway.js';
import { sourceImageCatalog, sourceAssets, originalSummaryElements } from './summary-sources.js';
import { SUMMARY_INSTRUCTIONS, SUMMARY_PROMPT_VERSION } from './summary-prompt.js';
import { INFOGRAPHIC_INSTRUCTIONS, normalizeInfographics } from './shared/infographics.js';
import { visualSourceSnapshot, infographicSourceIds } from './server/infographic-sources.js';

export { availableModels } from './server/ai/catalog.js';
export async function awaitJobCleanup(jobs) {
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(jobs.map((j) => j.task)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('相关 AI任务仍在结束，请稍后重试永久删除')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function buildSummaryPrompt(board, r) {
  r = { ...r, elements: originalSummaryElements(r.elements || [], board.summaries || []) };
  const texts = (r.elements || [])
    .filter((e) => e.type === 'text' && !e.isDeleted)
    .map((e) => ({ id: e.id, text: e.text, x: e.x, y: e.y }));
  const imageNotes = (r.elements || [])
    .filter((e) => e.type === 'image' && !e.isDeleted && e.customData?.studyboard?.imageNote)
    .map((e) => ({ imageId: e.id, note: e.customData.studyboard.imageNote }));
  const arrows = (r.elements || [])
    .filter((e) => e.type === 'arrow' && !e.isDeleted)
    .map((e) => ({
      from: e.startBinding?.elementId || null,
      to: e.endBinding?.elementId || null,
      x: e.x,
      y: e.y,
      points: e.points,
    }));
  let context = `网页随手记：${r.scope === 'selection' ? '' : (board.webNotes?.text || '').slice(0, 50000)}\n标题：${board.title}\n范围：${r.scope === 'selection' ? '选中区域' : '整张白板'}\n白板文字与连线：${JSON.stringify({ texts, arrows, imageNotes, sourceImages: sourceImageCatalog(r.elements) }).slice(0, 50000)}`;
  if (r.mode === 'expand') {
    const parent = board.summaries.find((s) => s.id === r.parentSummaryId);
    if (!parent || parent.deletedAt) throw new Error('要拓展的总结已删除或不存在');
    const concept = legacyStudy(parent).concepts.find((c) => c.id === r.conceptId);
    if (!concept) throw new Error('找不到要拓展的主题');
    context = `请围绕选定主题深化解释，补充有依据的机制、关系、边界或洞见；无需重复原总结，不为凑内容添加案例或问题。拓展方向：${r.direction || '深入理解'}。\n原主题资料：${JSON.stringify(concept)}`;
  }
  if (r.mode === 'restructure') {
    const parent = board.summaries.find((s) => s.id === r.parentSummaryId);
    if (!parent || parent.deletedAt) throw new Error('要整理的总结已删除或不存在');
    context = `重新识别这份旧总结的核心主题，舍去旁枝细节、重复解释和低价值练习，重组为有主线的简洁专题。\n旧总结：${parent.text.slice(0, 60000)}`;
  }
  const visuals =
    r.infographics === false
      ? '本次关闭自动信息图。infographics 必须为空数组，visualDecision 留空。原有原图引用与简单示意图按内容需要选择。'
      : INFOGRAPHIC_INSTRUCTIONS;
  const visualSources = visualSourceSnapshot(board, r.elements, r.scope);
  return `${SUMMARY_INSTRUCTIONS}\n\n${visuals}\n\n输出 JSON Schema：\n${JSON.stringify(STUDY_SCHEMA)}\n\n【提供的资料】\n${context}\n\n图文来源：${JSON.stringify(visualSources).slice(0, 45000)}\n\n【用户学习目标】\n${(r.instructions || '').slice(0, 2500) || '识别核心主题，串联主张、机制、人物或概念关系，提炼成简洁的图文专题。'}\n\n【本次复习要求】\n每次都生成 1～8 道真正值得长期复习的核心问题，最多 8 题；按材料需要取舍，不凑满。questions 不得为空数组。\n\n【配图识别】\n${r.images?.length ? '附图先是整张画布的分区预览，随后是带 S 编号的原图细节。原图索引位于 sourceImages。sourceFigures 与信息图图片只引用已有的 S 编号，不能将所有图片都加入正文。' : '本次没有提供原图，sourceFigures 必须为空数组，信息图不得使用 image 节点。'}`;
}
export class SummaryJobs {
  constructor(ctx, store, { timeoutMs = 1800000, infographicsEnabled = () => true } = {}) {
    this.ctx = ctx;
    this.store = store;
    this.jobs = new Map();
    this.timeoutMs = timeoutMs;
    this.infographicsEnabled = infographicsEnabled;
  }
  async start(r) {
    if (!r || !['summary', 'expand', 'restructure'].includes(r.mode || 'summary'))
      throw new Error('学习任务类型不支持');
    r = { ...r, includeReview: true, images: r.images || [], elements: r.elements || [] };
    if (!Array.isArray(r.images) || r.images.length > 20) throw new Error('请选择白板内容后再总结');
    if (!Array.isArray(r.elements) || r.elements.length > 50000) throw new Error('学习内容不正确');
    if (
      r.images.some(
        (i) =>
          !i ||
          !['image/png', 'image/jpeg'].includes(i.mimeType) ||
          typeof i.data !== 'string' ||
          i.data.length > 12_000_000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(i.data),
      )
    )
      throw new Error('白板预览图过大或格式不正确');
    const b = await this.store.read(r.id);
    if ((!r.mode || r.mode === 'summary') && !r.images.length && !(b.webNotes?.text || '').trim())
      throw new Error('请先记录内容或添加截图');
    if (b.deletedAt) throw new Error('请先恢复笔记');
    if (b.revision !== r.revision) throw new Error('白板发生更新，请保存后重试');
    const model = (await availableModels(this.ctx.llm)).find(
      (m) =>
        m.provider === r.provider &&
        (m.id === r.model || (r.provider === 'codex-local' && r.model === 'default' && m.configured)),
    );
    if (!model) throw new Error('所选模型不可用，请刷新模型列表');
    if (model.unavailable) throw new Error(model.unavailable);
    r = {
      ...r,
      model: model.id,
      reasoningEffort: model.reasoningEffort,
      elements: originalSummaryElements(r.elements, b.summaries),
      infographics: this.infographicsEnabled() && r.infographics !== false,
    };
    if (r.images.length && !model.vision)
      throw new Error('白板含有图像，请选择支持图片的模型；纯文字拓展可用文字模型');
    buildSummaryPrompt(b, r);
    if ([...this.jobs.values()].some((j) => j.boardId === r.id && j.status === 'running'))
      throw new Error('这篇笔记正在生成学习内容，请等待或取消');
    const job = {
      id: randomUUID(),
      boardId: b.id,
      parentSummaryId: r.parentSummaryId || null,
      status: 'running',
      phase: r.provider === 'codex-local' ? '正在连接本机 Codex' : '正在阅读与组织内容',
      text: '',
      error: null,
      controller: new AbortController(),
      sourceRevision: b.revision,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    job.task = this.run(job, b, r).catch((e) => {
      job.status = 'error';
      job.error = e.message;
    });
    for (const [id, j] of this.jobs)
      if (j.status !== 'running' && Date.now() - Date.parse(j.createdAt) > 3_600_000) this.jobs.delete(id);
    return this.view(job);
  }
  view(j) {
    if (!j) throw new Error('学习任务已过期，请重试');
    const { controller, task, ...v } = j;
    return v;
  }
  async forgetBoards(ids) {
    const targets = [...this.jobs.values()].filter((j) => ids.includes(j.boardId));
    for (const j of targets) if (j.status === 'running') this.cancel(j.id);
    await awaitJobCleanup(targets);
    for (const j of targets) this.jobs.delete(j.id);
  }
  get(id) {
    return this.view(this.jobs.get(id));
  }
  async summaryChanged(summary) {
    const affected = [];
    for (const job of this.jobs.values()) {
      if (job.summary?.id === summary.id) job.summary = summary;
      if (summary.deletedAt && job.status === 'running' && job.parentSummaryId === summary.id) {
        this.cancel(job.id);
        affected.push(job);
      }
    }
    await awaitJobCleanup(affected);
  }
  latest(boardId) {
    const job = [...this.jobs.values()].filter((j) => j.boardId === boardId).at(-1);
    return job && !job.summary?.deletedAt && Date.now() - Date.parse(job.createdAt) < 3600000
      ? this.view(job)
      : null;
  }
  cancel(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('任务不存在');
    if (j.status === 'running') {
      j.controller.abort(Object.assign(new Error('已取消总结'), { code: 'USER_CANCELLED' }));
      j.status = 'cancelled';
    }
    return this.view(j);
  }
  dispose() {
    for (const j of this.jobs.values())
      if (j.status === 'running')
        j.controller.abort(
          Object.assign(new Error('DSH 服务已停止，任务未完成'), { code: 'SERVICE_STOPPED' }),
        );
    return Promise.allSettled([...this.jobs.values()].map((job) => job.task));
  }
  async run(job, b, r) {
    const timer = setTimeout(
      () =>
        job.controller.abort(
          Object.assign(new Error('AI总结超过 30 分钟仍未完成，已停止等待。请缩小范围后重试。'), {
            code: 'SUMMARY_TIMEOUT',
          }),
        ),
      this.timeoutMs,
    );
    let inputRecord;
    const inputFile = join(this.store.root, 'summary-inputs', job.id + '.json');
    try {
      const prompt = buildSummaryPrompt(b, r);
      const content = await this.ctx.attachments.admitPromptContent([
        { type: 'text', text: prompt },
        ...r.images.map((i, n) => ({
          type: 'image',
          data: i.data,
          mediaType: i.mimeType,
          name: `白板区域-${n + 1}`,
        })),
      ]);
      inputRecord = {
        boardId: b.id,
        revision: b.revision,
        mode: r.mode || 'summary',
        promptVersion: SUMMARY_PROMPT_VERSION,
        provider: r.provider,
        model: r.model,
        reasoningEffort: r.reasoningEffort || null,
        includeReview: true,
        content,
        createdAt: job.createdAt,
      };
      inputRecord.status = 'running';
      inputRecord.hostPid = process.pid;
      await atomicWrite(inputFile, inputRecord);
      job.text = (
        await new ModelGateway(this.ctx).text({
          modelInfo: { provider: r.provider, id: r.model, reasoningEffort: r.reasoningEffort, vision: true },
          prompt,
          images: r.images,
          content,
          schema: STUDY_SCHEMA,
          signal: job.controller.signal,
          progress: (p) => (job.phase = p),
          maxTokens: r.infographics ? 15000 : 8000,
        })
      ).text;
      if (job.controller.signal.aborted) throw job.controller.signal.reason || new Error('生成已取消');
      let study;
      try {
        study = parseStudy(job.text);
      } catch (e) {
        throw new Error('模型返回的学习结构不完整，请重试。' + e.message);
      }
      if (!study.questions.length) throw new Error('模型未生成有效的核心复习题，请重试');
      const visualSources = visualSourceSnapshot(b, r.elements, r.scope).filter(
        (s) => s.kind !== 'image' || r.images.length,
      );
      study.infographics =
        r.infographics && this.infographicsEnabled()
          ? normalizeInfographics(study.infographics, { sources: visualSources })
          : [];
      const usedSources = new Set(infographicSourceIds(study.infographics));
      const assets = sourceAssets(study, b, r.elements);
      job.summary = await this.store.addSummary(b.id, {
        text: studyText(study),
        study,
        assets,
        visualSources: visualSources.filter((s) => usedSources.has(s.id)),
        reasoningEffort: r.reasoningEffort || null,
        annotations: [],
        sourceRevision: b.revision,
        sourceWebNotesVersion: b.webNotes?.version || 0,
        scope: r.scope || 'board',
        elementIds: r.elements.map((e) => e.id),
        provider: r.provider,
        model: r.model,
        promptVersion: SUMMARY_PROMPT_VERSION,
        inputId: job.id,
        kind: r.mode || 'summary',
        parentSummaryId: r.parentSummaryId || null,
        parentConceptId: r.conceptId || null,
      });
      job.status = 'done';
      job.phase = '学习内容已保存';
    } catch (e) {
      if (job.status !== 'cancelled') {
        job.status = 'error';
        job.error =
          (job.controller.signal.aborted ? job.controller.signal.reason?.message : null) ||
          e.message ||
          '生成失败';
      }
    } finally {
      clearTimeout(timer);
      job.finishedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - Date.parse(job.createdAt);
      job.stopReason = job.controller.signal.aborted
        ? job.controller.signal.reason?.code || 'CANCELLED'
        : job.status === 'done'
          ? 'COMPLETED'
          : 'FAILED';
      if (inputRecord)
        await atomicWrite(inputFile, {
          ...inputRecord,
          status: job.status,
          finishedAt: job.finishedAt,
          elapsedMs: job.elapsedMs,
          stopReason: job.stopReason,
          error: job.error,
        }).catch(() => {});
    }
  }
}
