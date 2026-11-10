import { unique, optionalText } from '../lib/values.js';
import { validateShape } from '../ai/gateway.js';
import { SYSTEM_STUDY_SCHEMA, STUDY_PLAN_SCHEMA } from './schema.js';

const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(id);
function ids(items, name) {
  if (items.some((item) => !validId(item.id)) || new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error(name + '编号缺失或重复，请重新生成');
}
function text(value, name, max) {
  if (!value?.trim() || value.length > max) throw new Error(name + '为空或过长，请缩小主题后重试');
  return value.trim();
}
export function validatePlan(plan) {
  validateShape(plan, STUDY_PLAN_SCHEMA);
  ids(plan.boards, '主图');
  text(plan.title, '主题', 160);
  text(plan.question, '核心问题', 600);
  text(plan.rationale, '表达方案', 1800);
  return plan;
}
export function supported(value, sources, records) {
  const evidence = sources.references(value.evidence, records, { required: false });
  const visuals = sources.sourceIds(value.visualSourceIds, records);
  if (visuals.some((source) => source.kind !== 'visual')) throw new Error('图像引用不是本次白板图像');
  if (value.origin === 'background' && (evidence.length || visuals.length))
    throw new Error('模型补充不能同时伪装为材料依据');
  if (value.origin !== 'background' && !evidence.length && !visuals.length)
    throw new Error('论证遗漏了可核对的依据');
  return { ...value, evidence: [...evidence, ...visuals], visualSourceIds: undefined };
}
export function validateStudy(value, { sources, records, history, plan }) {
  validateShape(value, SYSTEM_STUDY_SCHEMA);
  text(value.title, '主题', 160);
  text(value.question, '核心问题', 600);
  text(value.overview, '概述', 1500);
  ids(value.boards, '主图');
  const boards = value.boards.map((board) => {
    ids(board.nodes, '节点');
    ids(board.edges, '关系');
    text(board.title, '图标题', 160);
    text(board.rationale, '图的表达理由', 1200);
    const nodeIds = new Set(board.nodes.map((n) => n.id)),
      slots = new Set();
    const nodes = board.nodes.map((node) => {
      text(node.title, '节点标题', 100);
      text(node.body, '节点说明', 900);
      if (
        !Number.isInteger(node.column) ||
        node.column < 0 ||
        node.column > 5 ||
        !Number.isInteger(node.row) ||
        node.row < 0 ||
        node.row > 12
      )
        throw new Error('白板排版位置无效，请重试');
      const slot = node.column + ':' + node.row;
      if (slots.has(slot)) throw new Error('模型把两个论点放在同一位置，请重试');
      slots.add(slot);
      return supported(node, sources, records);
    });
    const edges = board.edges.map((edge) => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to)
        throw new Error('论证关系引用了无效节点');
      text(edge.label, '关系说明', 60);
      return supported(edge, sources, records);
    });
    return { ...board, nodes, edges };
  });
  const historical = { ...value.history, periods: [] };
  if (!history) {
    historical.applicable = false;
    historical.reason = '本次未开启时间旅行研究';
  }
  if (history && historical.applicable) {
    if (value.history.periods.length < 2) throw new Error('历史研究需要至少两个有意义的阶段');
    ids(value.history.periods, '历史阶段');
    historical.periods = value.history.periods
      .map((period) => {
        if (
          !Number.isInteger(period.cutoffYear) ||
          period.cutoffYear < -5000 ||
          period.cutoffYear > new Date().getFullYear()
        )
          throw new Error('历史阶段的知识截止年不正确');
        for (const field of [
          'label',
          'problem',
          'availableKnowledge',
          'explanation',
          'unknown',
          'laterRevision',
        ])
          text(period[field], '历史研究内容', field === 'label' ? 120 : 1000);
        const evidence = sources.references(period.evidence, records, { required: false });
        const laterEvidence = sources.references(period.laterEvidence, records, { required: false });
        if (!evidence.length && !laterEvidence.length) throw new Error('历史重建没有资料依据');
        for (const source of evidence) {
          const year = source.publishedAt && Number(source.publishedAt.slice(0, 4));
          if (year && year > period.cutoffYear) throw new Error('历史研究引用了截止年之后的证据，请重新生成');
        }
        return {
          ...period,
          evidence,
          laterEvidence,
          dateStatus: evidence.length && evidence.every((s) => s.publishedAt) ? 'dated' : 'retrospective',
        };
      })
      .sort((a, b) => a.cutoffYear - b.cutoffYear);
  }
  if (!historical.applicable && !historical.reason.trim())
    historical.reason = '当前资料不足以支持有意义的历史研究';
  return {
    ...value,
    boards,
    history: historical,
    plan,
    nextSteps: value.nextSteps.map((step) => ({
      ...step,
      question: text(step.question, '下一步问题', 600),
      why: optionalText(step.why, 1000),
      sources: sources.sourceIds(step.sourceIds, records),
      sourceIds: undefined,
    })),
    reviewQuestions: value.reviewQuestions.map((q) => ({
      ...supported(q, sources, records),
      prompt: text(q.prompt, '复习问题', 800),
      answer: text(q.answer, '参考答案', 2500),
    })),
    sourceKinds: unique(records.map((record) => record.kind)),
  };
}
