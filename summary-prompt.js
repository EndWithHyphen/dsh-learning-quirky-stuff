import {
  SUMMARY_EDITOR_INSTRUCTIONS,
  SUMMARY_ORGANIZATION_INSTRUCTIONS,
  SUMMARY_OUTPUT_INSTRUCTIONS,
} from './server/summary/prompts.js';

export const SUMMARY_PROMPT_VERSION = 'topic-2026-11-14-v7';
const canvasStrategy = [SUMMARY_EDITOR_INSTRUCTIONS, SUMMARY_ORGANIZATION_INSTRUCTIONS].join('\n\n');
const webStrategy =
  'overview 用一两句说明文章回答的问题与核心结论。points 按理解顺序组织，每项用 body 解释一个关键机制、对比或步骤，cue 给一句能唤起该要点的短提示。条数取决于材料，不凑数。';
export function summaryStrategy(template, surface) {
  return template?.prompt || (surface === 'web' ? webStrategy : canvasStrategy);
}
export function canvasSummaryInstructions(template) {
  return [summaryDirections(template, 'canvas'), SUMMARY_OUTPUT_INSTRUCTIONS].join('\n\n');
}
export function summaryDirections(template, surface) {
  const strategy = summaryStrategy(template, surface);
  return template?.common?.prompt ? strategy + '\n\n【共用提示词】\n' + template.common.prompt : strategy;
}
export const SUMMARY_INSTRUCTIONS = canvasSummaryInstructions();
