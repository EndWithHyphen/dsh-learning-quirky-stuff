export const DEFAULT_SUMMARY_TEMPLATE = { id: 'default', name: '默认模板', revision: 1, prompt: '' };
export const SUMMARY_PRESETS = [
  DEFAULT_SUMMARY_TEMPLATE,
  {
    id: 'recall',
    name: '速记复习',
    revision: 1,
    prompt:
      '把材料整理成可以合上原文复述的复习笔记。先用一两句点出最值得记住的结论，再按回忆顺序排列要点。每个要点用短句写明要记什么，并给一个能唤起答案的线索。保留影响答案的术语、数字和条件。自测题先问最容易忘的细节，再问要点之间的联系，给出简短的核对答案。',
  },
  {
    id: 'explain',
    name: '原理讲解',
    revision: 1,
    prompt:
      '把材料讲给第一次接触主题的读者。先提出材料要解释的问题，交代关键概念，再沿着原因、过程和结果说明为什么会这样。用材料中的具体例子检验解释，指出适用条件和容易混淆的地方。自测题让读者解释原因，或判断条件改变后结论是否成立，并说明理由。',
  },
];

export const summaryTemplates = (custom = []) => [...SUMMARY_PRESETS, ...custom];

export function resolveSummaryTemplate(id, custom = []) {
  const wanted = id ?? DEFAULT_SUMMARY_TEMPLATE.id;
  const template = summaryTemplates(custom).find((item) => item.id === wanted);
  if (!template) throw new Error('这套总结模板已不存在，请重新选择');
  return { ...template };
}

export function templateLabel(template = DEFAULT_SUMMARY_TEMPLATE) {
  const name =
    template?.revision > 1
      ? template.name + ' · v' + template.revision
      : template?.name || DEFAULT_SUMMARY_TEMPLATE.name;
  return template?.common?.revision ? name + ' · 共用提示词 v' + template.common.revision : name;
}
