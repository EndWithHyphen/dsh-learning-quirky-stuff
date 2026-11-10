import { INFOGRAPHIC_SCHEMA, normalizeInfographics } from './shared/infographics.js';
const str = { type: 'string' };
const arr = (items) => ({ type: 'array', items });
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const STUDY_SCHEMA = object({
  title: str,
  overview: str,
  takeaways: arr(str),
  scopeNote: str,
  visualDecision: str,
  infographics: arr(INFOGRAPHIC_SCHEMA),
  concepts: arr(
    object({
      id: str,
      title: str,
      canonicalKey: str,
      explanation: str,
      example: str,
      prerequisites: arr(str),
    }),
  ),
  relations: arr(object({ from: str, to: str, label: str })),
  diagrams: arr(
    object({
      id: str,
      title: str,
      kind: { type: 'string', enum: ['flow', 'cycle', 'hierarchy', 'comparison', 'timeline'] },
      placement: { type: 'string', enum: ['overview', 'inline'] },
      nodes: arr(object({ id: str, label: str, detail: str })),
      edges: arr(object({ from: str, to: str, label: str })),
      caption: str,
      conceptIds: arr(str),
    }),
  ),
  sourceFigures: arr(object({ id: str, sourceId: str, title: str, caption: str, conceptIds: arr(str) })),
  insights: arr(object({ id: str, title: str, text: str, conceptIds: arr(str) })),
  questions: {
    ...arr(
      object({
        id: str,
        kind: { type: 'string', enum: ['recall', 'apply', 'explain'] },
        difficulty: { type: 'string', enum: ['basic', 'intermediate', 'advanced'] },
        prompt: str,
        context: str,
        tasks: arr(str),
        answer: str,
        hint: str,
        checkpoints: arr(str),
        conceptIds: arr(str),
      }),
    ),
    minItems: 1,
    maxItems: 8,
  },
  extensions: arr(object({ topic: str, question: str })),
});
const trim = (x, max = 10000) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const list = (x) => (Array.isArray(x) ? x : []);
const clean = (s) =>
  trim(s)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '');
export function parseStudy(raw) {
  const value =
    typeof raw === 'string'
      ? JSON.parse(
          raw
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, ''),
        )
      : raw;
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.concepts) ||
    !Array.isArray(value.questions)
  )
    throw new Error('模型没有返回完整的学习结构，请重试');
  const concepts = value.concepts
    .slice(0, 16)
    .map((c, i) => ({
      id: `c${i + 1}`,
      oldId: trim(c.id, 80),
      title: trim(c.title, 160),
      canonicalKey: trim(c.canonicalKey, 220) || trim(c.title, 160),
      explanation: trim(c.explanation, 14000),
      example: trim(c.example, 8000),
      prerequisites: list(c.prerequisites)
        .map((s) => trim(s, 200))
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((c) => c.title && c.explanation);
  if (!concepts.length) throw new Error('模型没有返回可学习的概念内容');
  const ids = new Map(concepts.map((c) => [c.oldId, c.id]));
  const refs = (values) => [
    ...new Set(
      list(values)
        .map((id) => ids.get(id))
        .filter(Boolean),
    ),
  ];
  const relations = list(value.relations)
    .slice(0, 40)
    .map((r) => ({ from: ids.get(r.from), to: ids.get(r.to), label: trim(r.label, 100) }))
    .filter((r) => r.from && r.to && r.from !== r.to);
  const diagrams = list(value.diagrams)
    .slice(0, 3)
    .map((d, i) => {
      const nodes = list(d.nodes)
        .slice(0, 10)
        .map((n, j) => ({
          id: trim(n.id, 60) || `n${j + 1}`,
          label: trim(n.label, 80),
          detail: trim(n.detail, 400),
        }))
        .filter((n) => n.label);
      const valid = new Set(nodes.map((n) => n.id));
      return {
        id: `d${i + 1}`,
        title: trim(d.title, 160),
        kind: ['flow', 'cycle', 'hierarchy', 'comparison', 'timeline'].includes(d.kind) ? d.kind : 'flow',
        placement: d.placement === 'overview' ? 'overview' : 'inline',
        nodes,
        edges: list(d.edges)
          .slice(0, 20)
          .map((e) => ({ from: trim(e.from, 60), to: trim(e.to, 60), label: trim(e.label, 60) }))
          .filter((e) => valid.has(e.from) && valid.has(e.to) && e.from !== e.to),
        caption: trim(d.caption, 2000),
        conceptIds: refs(d.conceptIds),
      };
    })
    .filter((d) => d.nodes.length > 1 && d.title);
  const questions = value.questions
    .slice(0, 8)
    .map((q, i) => ({
      id: `q${i + 1}`,
      kind: ['recall', 'apply', 'explain'].includes(q.kind) ? q.kind : 'recall',
      difficulty: ['basic', 'intermediate', 'advanced'].includes(q.difficulty) ? q.difficulty : 'basic',
      prompt: trim(q.prompt, 3000),
      context: trim(q.context, 8000),
      tasks: list(q.tasks)
        .map((t) => trim(t, 2000))
        .filter(Boolean)
        .slice(0, 8),
      answer: trim(q.answer, 8000),
      hint: trim(q.hint, 1000),
      checkpoints: list(q.checkpoints)
        .map((t) => trim(t, 1200))
        .filter(Boolean)
        .slice(0, 8),
      conceptIds: refs(q.conceptIds),
    }))
    .filter((q) => q.prompt && q.answer);
  const v3 =
    Array.isArray(value.takeaways) || Array.isArray(value.sourceFigures) || Array.isArray(value.infographics);
  return {
    version: v3 ? 3 : 2,
    title: trim(value.title, 200) || '学习总结',
    overview: trim(value.overview, 6000),
    ...(v3
      ? {
          takeaways: list(value.takeaways)
            .map((t) => trim(t, 400))
            .filter(Boolean)
            .slice(0, 4),
          scopeNote: trim(value.scopeNote, 800),
          visualDecision: trim(value.visualDecision, 600),
          infographics: normalizeInfographics(value.infographics, { conceptIds: ids }),
          sourceFigures: list(value.sourceFigures)
            .slice(0, 4)
            .map((f, i) => ({
              id: 'f' + (i + 1),
              sourceId: trim(f.sourceId, 40),
              title: trim(f.title, 160),
              caption: trim(f.caption, 1000),
              conceptIds: refs(f.conceptIds),
            }))
            .filter((f) => f.sourceId && f.title),
          insights: list(value.insights)
            .slice(0, 2)
            .map((s, i) => ({
              id: 'i' + (i + 1),
              title: trim(s.title, 160),
              text: trim(s.text, 2200),
              conceptIds: refs(s.conceptIds),
            }))
            .filter((s) => s.title && s.text),
        }
      : {}),
    concepts: concepts.map(({ oldId, ...c }) => c),
    relations,
    diagrams,
    questions,
    extensions: list(value.extensions)
      .slice(0, 8)
      .map((e) => ({ topic: trim(e.topic, 160), question: trim(e.question, 1000) }))
      .filter((e) => e.topic && e.question),
  };
}
export function studyText(s) {
  const parts = ['# ' + s.title, s.overview];
  if (s.takeaways?.length) parts.push(s.takeaways.map((t) => '• ' + t).join('\n'));
  for (const c of s.concepts) {
    parts.push('## ' + c.title + '\n' + c.explanation + (c.example ? '\n\n' + c.example : ''));
    for (const f of s.sourceFigures || [])
      if (f.conceptIds[0] === c.id) parts.push('配图：' + f.title + '\n' + f.caption);
  }
  for (const d of s.diagrams)
    parts.push('## ' + d.title + '\n' + d.nodes.map((n) => n.label).join(' · ') + '\n' + d.caption);
  for (const i of s.insights || []) parts.push('## ' + i.title + '\n' + i.text);
  for (const f of s.infographics || [])
    parts.push(
      '## ' +
        f.title +
        '\n' +
        f.nodes
          .filter((n) => n.kind === 'text')
          .map((n) => n.text)
          .join('\n') +
        '\n' +
        f.caption,
    );
  if (s.scopeNote) parts.push('材料范围：' + s.scopeNote);
  if (s.questions.length)
    parts.push(
      '## 自测\n' +
        s.questions
          .map(
            (q, i) =>
              i +
              1 +
              '. ' +
              q.prompt +
              (q.context ? '\n题干与条件：' + q.context : '') +
              (q.tasks?.length ? '\n作答任务：\n' + q.tasks.map((t, j) => j + 1 + ') ' + t).join('\n') : '') +
              '\n答案：' +
              q.answer +
              (q.checkpoints?.length ? '\n核对要点：\n' + q.checkpoints.map((t) => '• ' + t).join('\n') : ''),
          )
          .join('\n\n'),
    );
  return parts.filter(Boolean).join('\n\n');
}

function numbered(s) {
  const out = [];
  let item;
  for (const line of s.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)）]\s*(.*)$/);
    if (m) {
      item = { n: m[1], text: m[2] };
      out.push(item);
    } else if (item && line.trim()) item.text += '\n' + line.trim();
  }
  return out;
}
export function legacyStudy(summary) {
  if ([2, 3].includes(summary.study?.version)) return summary.study;
  const raw = summary.text || '',
    sections = [];
  let current = { title: '概览', body: '' };
  for (const line of raw.split('\n')) {
    const m = line.match(/^#{1,4}\s+(.+)$/);
    if (m) {
      if (current.body.trim()) sections.push(current);
      current = { title: m[1], body: '' };
    } else current.body += line + '\n';
  }
  if (current.body.trim()) sections.push(current);
  const qSection = sections.find((s) => /自测题|练习题/.test(s.title)),
    aSection = sections.find((s) => /自测答案|参考答案/.test(s.title));
  const answers = new Map(numbered(aSection?.body || '').map((x) => [x.n, clean(x.text)]));
  let content = sections.filter((s) => !/易错|待确认|自测题|自测答案|练习题|参考答案/.test(s.title));
  if (!content.length) content = [{ title: '学习内容', body: raw }];
  return {
    version: 2,
    title: '学习总结',
    overview: '',
    concepts: content.map((s, i) => ({
      id: `legacy-c${i + 1}`,
      title: clean(s.title),
      canonicalKey: '',
      explanation: clean(s.body),
      example: '',
      prerequisites: [],
    })),
    relations: [],
    diagrams: [],
    questions: numbered(qSection?.body || '')
      .map((q) => ({
        id: `legacy-q${q.n}`,
        kind: 'recall',
        prompt: clean(q.text),
        answer: answers.get(q.n) || '',
        hint: '',
        conceptIds: [],
      }))
      .filter((q) => q.answer),
    extensions: [],
  };
}
export function blockTexts(study) {
  const out = { overview: study.overview };
  for (const [i, text] of (study.takeaways || []).entries()) out['takeaway:' + i] = text;
  if (study.scopeNote) out.scopeNote = study.scopeNote;
  for (const f of study.sourceFigures || []) out['figure:' + f.id + ':caption'] = f.caption;
  for (const s of study.insights || []) out['insight:' + s.id] = s.text;
  for (const c of study.concepts) {
    out[`concept:${c.id}:explanation`] = c.explanation;
    out[`concept:${c.id}:example`] = c.example;
  }
  for (const d of study.diagrams) out[`diagram:${d.id}:caption`] = d.caption;
  for (const q of study.questions) out[`question:${q.id}:answer`] = q.answer;
  return out;
}
export function conceptKey(c) {
  return (c.canonicalKey || c.title).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
