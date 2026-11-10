import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { legacyStudy, parseStudy, studyText, blockTexts } from '../study-schema.js';
import { studyFixture, spoFixture } from './fixture.mjs';
import { graphInput, parseGraphReport } from '../graph-ai.js';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';
async function setup() {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'study-learning-'))).init(),
    learning = await new LearningStore(store).init(),
    board = await store.create({ title: '笔记 A' });
  const summary = await store.addSummary(board.id, {
    study: studyFixture,
    text: studyText(studyFixture),
    sourceRevision: 0,
    annotations: [],
  });
  return { store, learning, board, summary };
}
test('结构化题干、任务与核对要点加入复习后完整保存，文本导出包含题目条件', async () => {
  const { store, learning, board } = await setup(),
    raw = structuredClone(studyFixture);
  Object.assign(raw.questions[0], {
    context: '已知数组有重复值。',
    tasks: ['给出边界。', '说明原因。'],
    checkpoints: ['保留了区间不变量。'],
    difficulty: 'intermediate',
  });
  const study = parseStudy(raw),
    summary = await store.addSummary(board.id, { study, text: studyText(study) });
  await learning.enroll({ id: board.id, summaryId: summary.id });
  const reopened = await new LearningStore(store).init(),
    card = (await reopened.dashboard()).cards[0];
  assert.equal(card.context, raw.questions[0].context);
  assert.deepEqual(card.tasks, raw.questions[0].tasks);
  assert.deepEqual(card.checkpoints, raw.questions[0].checkpoints);
  assert.equal(card.difficulty, 'intermediate');
  assert.ok(studyText(study).includes(raw.questions[0].context));
  assert.ok(studyText(study).includes(raw.questions[0].tasks[1]));
});
test('不再出现的复习卡重启后仍被排除，重复加入不重新启用，恢复后继续原进度', async () => {
  const { store, learning, board, summary } = await setup();
  await learning.enroll({ id: board.id, summaryId: summary.id });
  const before = await learning.dashboard(),
    card = before.cards[0],
    schedule = structuredClone(card.schedule);
  await learning.dispatch({ action: 'suspendReview', cardId: card.id, suspended: true });
  const reopened = await new LearningStore(store).init(),
    hidden = await reopened.dashboard();
  assert.equal(
    hidden.cards.some((c) => c.id === card.id),
    false,
  );
  assert.equal(hidden.total, before.total - 1);
  assert.equal(hidden.suspended[0].id, card.id);
  const repeated = await reopened.enroll({
    id: board.id,
    summaryId: summary.id,
    questionId: card.questionId,
  });
  assert.equal(repeated.added, 0);
  assert.equal(repeated.suspended, 1);
  assert.equal(
    (await reopened.dashboard()).cards.some((c) => c.id === card.id),
    false,
  );
  await assert.rejects(
    reopened.review({ cardId: card.id, version: card.version, grade: 3, eventId: 'stale-review' }),
    /不再出现/,
  );
  await reopened.suspendReview({ cardId: card.id, suspended: false });
  const restored = await reopened.dashboard();
  assert.ok(restored.cards.some((c) => c.id === card.id));
  assert.deepEqual(reopened.data.cards[card.id].schedule, schedule);
  assert.equal(restored.suspended.length, 0);
  assert.equal(isRemoteJsonValue(restored), true);
});
test('划线、高亮与备注保存在具体文本位置，重载与新总结不会丢批注', async () => {
  const { store, learning, board, summary } = await setup();
  const request = {
    id: board.id,
    summaryId: summary.id,
    blockId: 'concept:c1:explanation',
    start: 0,
    end: 3,
    quote: '先尝试',
    kind: 'underline',
    note: '先自己想',
  };
  let r = await learning.annotation(request);
  assert.equal(r.annotations[0].quote, '先尝试');
  await learning.annotation({ ...request, annotationId: r.annotations[0].id, note: '我自己的例子' });
  await store.addSummary(board.id, { study: studyFixture, text: '新总结' });
  const fresh = await new LibraryStore(store.root).init();
  const old = (await fresh.read(board.id)).summaries[0];
  assert.equal(old.annotations[0].note, '我自己的例子');
  await assert.rejects(learning.annotation({ ...request, quote: '错误引用' }), /已变化/);
  r = await learning.annotation({ id: board.id, summaryId: summary.id, remove: old.annotations[0].id });
  assert.equal(r.annotations.length, 0);
});
test('旧总结迁移：保留内容与问答，阅读结构去掉易错点栏目', () => {
  const legacy = legacyStudy({
    text: '## 核心概念\n主动回忆。\n## 易错点与待确认\n不需要的栏目。\n## 自测题\n1. 顺序？\n## 自测答案\n1. 先回答，再核对。',
  });
  assert.equal(legacy.questions.length, 1);
  assert.equal(legacy.questions[0].answer, '先回答，再核对。');
  assert.equal(
    legacy.concepts.some((c) => /易错/.test(c.title)),
    false,
  );
});
test('结构化输出拒绝空内容，图形仅保留指向真实节点的关系', () => {
  const data = structuredClone(studyFixture);
  data.diagrams[0].edges.push({ from: 'bad', to: 'b', label: '坏边' });
  const s = parseStudy(JSON.stringify(data));
  assert.equal(s.diagrams[0].edges.length, 1);
  assert.equal(blockTexts(s)['concept:c1:explanation'], '先尝试自己回答，再查看笔记。');
  assert.throws(() => parseStudy('普通文本'));
  assert.throws(() => parseStudy({ concepts: [], questions: [] }));
});
test('FSRS 复习反馈推进到期时间，重复提交不重复记一次，重启后可继续排程', async () => {
  const { store, learning, board, summary } = await setup();
  assert.equal((await learning.enroll({ id: board.id, summaryId: summary.id })).added, 1);
  assert.equal((await learning.enroll({ id: board.id, summaryId: summary.id })).added, 0);
  const d = await learning.dashboard();
  assert.equal(d.dueCount, 1);
  assert.equal(isRemoteJsonValue(d), true);
  const c = d.cards[0],
    request = { cardId: c.id, version: 0, grade: 3, eventId: 'same-review', answer: '先回答再核对' };
  const preview = await learning.preview({ cardId: c.id });
  assert.equal(preview.length, 4);
  assert.equal(isRemoteJsonValue(preview), true);
  const result = await learning.review(request);
  assert.equal(isRemoteJsonValue(result), true);
  assert.ok(new Date(result.card.schedule.dueAt) > new Date());
  assert.equal((await learning.review(request)).duplicate, true);
  await assert.rejects(learning.review({ ...request, eventId: 'other' }), /其他窗口/);
  const reopened = await new LearningStore(store).init();
  assert.equal((await reopened.dashboard()).dueCount, 0);
  assert.equal(reopened.data.reviews.length, 1);
  assert.equal((await reopened.preview({ cardId: c.id })).length, 4);
});
test('知识图连接不同笔记和历次总结，保留每个来源及手动关系', async () => {
  const { store, learning, board, summary } = await setup();
  const b = await store.create({ title: '笔记 B' });
  await store.addSummary(b.id, { study: studyFixture, text: '另一个笔记' });
  const input = await graphInput(learning);
  await learning.saveGraphReport({
    ...parseGraphReport(spoFixture(input), input),
    id: 'report',
    fingerprint: input.fingerprint,
    coverage: input.coverage,
  });
  const graph = await learning.graph();
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0].sources.length, 2);
  assert.ok(graph.edges.length);
  await learning.link({ from: graph.nodes[0].id, to: graph.nodes[1].id, label: '我的联想' });
  assert.ok((await learning.graph()).edges.some((e) => e.label === '我的联想'));
  await store.metadata({ id: b.id, deleted: true });
  assert.equal((await learning.graph()).nodes[0].sources.length, 1);
});
test('学习备份包含批注与复习进度，原笔记始终保留', async () => {
  const { learning, board, summary } = await setup();
  await learning.enroll({ id: board.id, summaryId: summary.id });
  const backup = await learning.dispatch({ action: 'backup' });
  assert.equal(Object.keys(backup.learning.cards).length, 1);
  assert.equal(backup.boards[0].summaries.length, 1);
});
