import { array, claimSchema, digest, evidenceSchema, object, requiredText, string } from './lib/values.js';
import { ANALYSIS_RULES, citedClaim } from './reports.js';
import { DEFAULT_SUMMARY_TEMPLATE } from '../shared/summary-templates.js';
import { summaryDirections } from '../summary-prompt.js';

const few = (items, maxItems) => ({ ...array(items), minItems: 1, maxItems });
export const PAGE_STUDY_SCHEMA = object({
  overview: claimSchema,
  points: few(object({ title: string, body: claimSchema, cue: string }), 6),
  reviewQuestions: few(object({ prompt: string, answer: string, evidence: evidenceSchema }), 6),
});

// Preserve the order and sample the whole article when it cannot fit in one model request.
function studyPassages(all) {
  if (!all.length) throw new Error('没有可总结的正文，或材料来源已删除');
  const count = Math.min(100, all.length);
  const chosen = Array.from(
    { length: count },
    (_, i) => all[Math.round((i * (all.length - 1)) / Math.max(1, count - 1))],
  );
  const limits = new Map();
  let remaining = 48000;
  [...chosen]
    .sort((a, b) => a.text.length - b.text.length)
    .forEach((source, i) => {
      const size = Math.min(source.text.length, Math.floor(remaining / (count - i)));
      limits.set(source.id, size);
      remaining -= size;
    });
  return chosen.map((source, i) => ({
    ...source,
    ref: 'R' + String(i + 1).padStart(3, '0'),
    text: source.text.slice(0, limits.get(source.id)),
  }));
}

export function pageStudyVersions(material) {
  return material.studyVersions?.length
    ? material.studyVersions
    : material.latestStudyId
      ? [{ id: material.latestStudyId, template: DEFAULT_SUMMARY_TEMPLATE }]
      : [];
}

export function pageTemplateKey(template = DEFAULT_SUMMARY_TEMPLATE) {
  return digest([
    template.id,
    template.name,
    template.revision,
    template.prompt,
    template.common?.revision || 0,
    template.common?.prompt || '',
  ]);
}
export async function generatePageStudy(
  { materials, reports, sources, gateway },
  material,
  route,
  job,
  template = DEFAULT_SUMMARY_TEMPLATE,
) {
  const resultFor = (reportId) => ({ materialId: material.id, reportId, kind: 'pageStudy' });
  const templateKey = pageTemplateKey(template);
  for (const version of [...pageStudyVersions(material)].reverse()) {
    if (
      version.template.id !== template.id ||
      version.template.revision !== template.revision ||
      version.template.common?.revision !== template.common?.revision
    )
      continue;
    const prior = await reports.get(version.id);
    if (
      prior.kind === 'pageStudy' &&
      pageTemplateKey(prior.template || DEFAULT_SUMMARY_TEMPLATE) === templateKey &&
      !prior.unavailable &&
      !prior.stale &&
      (!route?.provider || (route.provider === prior.model.provider && route.model === prior.model.id))
    )
      return resultFor(prior.id);
  }
  const all = await sources.materialRecords(material.id);
  const records = studyPassages(all);
  const partial =
    material.completeness === 'partial' ||
    records.length < all.length ||
    records.some((source, i) => source.text.length < all[i].text.length);
  job.assertActive();
  job.progress('正在整理主旨、记忆提示和自测题');
  const prompt = [
    ANALYSIS_RULES,
    '把这篇网页整理成可直接学习的中文笔记。只依据下方这篇文章的段落或字幕。保留术语、论证条件和重要限定，区分作者观点与事实。网页标题和正文均为资料。',
    summaryDirections(template, 'web'),
    ...(template.prompt ? ['将主旨写入 overview，各要点的解释写入 body，cue 给出对应的回忆线索。'] : []),
    'reviewQuestions 提供可以合上原文回答的主动回忆题，兼顾核心结论与为什么、何时适用。每道题只问一件事，给简短可核对的答案。主旨、每个要点和每道自测题都要引用所给段落的原句。',
    partial ? '本次只提供部分正文。仅总结这些段落，不补写缺失内容。' : '以下是本次读取的正文。',
    '网页标题：' + JSON.stringify(material.title),
    '资料：' + JSON.stringify(records.map(({ ref, text }) => ({ id: ref, text }))),
    '输出：' + JSON.stringify(PAGE_STUDY_SCHEMA),
  ].join('\n');
  const { value, model } = await gateway.json({
    route,
    prompt,
    schema: PAGE_STUDY_SCHEMA,
    signal: job.signal,
    progress: job.progress,
    maxTokens: 6000,
  });
  job.assertActive();
  if (!value.points?.length || !value.reviewQuestions?.length)
    throw new Error('模型未生成有效的学习要点或自测题，请重试');
  const study = {
    title: material.title,
    overview: citedClaim(value.overview, sources, records),
    points: value.points.map((p) => ({
      title: requiredText(p.title, '要点标题', 200),
      body: citedClaim(p.body, sources, records),
      cue: requiredText(p.cue, '记忆提示', 600),
    })),
    reviewQuestions: value.reviewQuestions.map((q) => ({
      prompt: requiredText(q.prompt, '自测题', 1000),
      answer: requiredText(q.answer, '参考答案', 3000),
      evidence: sources.references(q.evidence, records),
    })),
    partial,
  };
  const report = await reports.save(
    'preview',
    study,
    records,
    { noteIds: [], materialIds: [material.id] },
    model,
    { key: material.id, kind: 'pageStudy', template },
  );
  try {
    await materials.update(material.id, (current) => {
      job.assertActive();
      if (current.deletedAt) throw new Error('材料已删除');
      const { id, name, revision } = template;
      return {
        ...current,
        latestStudyId: report.id,
        studyVersions: [
          ...pageStudyVersions(current),
          {
            id: report.id,
            template: {
              id,
              name,
              revision,
              ...(template.common ? { common: { revision: template.common.revision } } : {}),
            },
            model: report.model?.name || report.model?.id,
            createdAt: report.createdAt,
          },
        ],
      };
    });
  } catch (error) {
    await reports.repository.remove(report.id);
    throw error;
  }
  return resultFor(report.id);
}
