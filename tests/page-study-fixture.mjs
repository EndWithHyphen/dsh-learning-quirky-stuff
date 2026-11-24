export function pageStudyResult(options) {
  const start = options.prompt.lastIndexOf('\n资料：') + '\n资料：'.length;
  const records = JSON.parse(options.prompt.slice(start, options.prompt.lastIndexOf('\n输出：')));
  const source = records.find((record) => record.text.includes('核对')) || records[0];
  const evidence = [{ sourceId: source.id, quote: source.text.slice(0, 48) }];
  const body = { text: '先尝试回忆，再核对资料，能发现遗漏。', evidence };
  return {
    model: { provider: 'fixture', id: 'fixture', name: '测试模型' },
    value: {
      overview: body,
      points: [{ title: '主动回忆', body, cue: '合上回忆，打开核对' }],
      reviewQuestions: [{ prompt: '回忆之后怎样发现遗漏？', answer: '对照原文核对遗漏。', evidence }],
    },
  };
}
