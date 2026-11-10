import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore, atomicWrite } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { weeklyPeriod, inWeek } from '../server/weekly-period.js';
import { studyFixture } from './fixture.mjs';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';

async function fixture(change = null) {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'weekly-study-'))).init(),
    learning = await new LearningStore(store).init();
  let calls = 0;
  const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async json({ prompt }) {
        calls++;
        const start = prompt.lastIndexOf('资料：') + 3,
          records = JSON.parse(prompt.slice(start, prompt.indexOf('\n输出：', start)));
        const claim = {
          text: '本周记录围绕主动回忆和证据核对展开。',
          evidence: [{ sourceId: records[0].id, quote: records[0].text.slice(0, 30) }],
        };
        const reference = records.find((r) => r.kind !== 'review') || records[0];
        const answerQuote =
          reference.kind === 'review'
            ? reference.text.split('参考答案（来自已保存复习卡）：')[1].split('\n')[0]
            : reference.text.slice(0, 30);
        const question = {
          kind: 'explain',
          prompt: '为什么回忆后还需要核对？',
          context: '',
          tasks: ['说明核对的作用'],
          answer: '核对能够发现解释中的遗漏和适用条件。',
          hint: '比较自己的解释与原材料。',
          checkpoints: ['指出遗漏', '检查适用条件'],
          evidence: [{ sourceId: reference.id, quote: answerQuote }],
        };
        const result = {
          value: {
            title: '本周学习回顾',
            overview: claim,
            knowledgeSummary: { mainline: claim, points: [{ title: '先回忆再核对', explanation: claim }] },
            reviewQuestions: [question],
            themes: [{ title: '回忆与核对', progress: claim }],
            changes: [],
            connections: [],
            nextWeek: [{ focus: '用新问题检验解释', reason: claim }],
            stats: { reviews: 999 },
          },
          model: { provider: 'fixture', id: 'fixture', name: '验证模型' },
        };
        if (change) change(result.value, records);
        return result;
      },
    },
  }).init();
  const note = await store.create({ title: '主动回忆' });
  await store.save({
    id: note.id,
    baseRevision: 0,
    scene: {
      elements: [
        { id: 'text', type: 'text', x: 0, y: 0, text: '主动回忆要求先尝试自己解释，再用材料检查遗漏。' },
      ],
      files: {},
      appState: {},
    },
  });
  return { store, learning, runtime, note, calls: () => calls };
}
async function done(runtime, task) {
  for (let i = 0; i < 200; i++) {
    const j = runtime.tasks.get(task.id);
    if (!['queued', 'running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('任务未完成');
}
test('周界线使用指定时区，周一零点包含、下一周零点排除，跨夏令时不按固定小时硬算', () => {
  const week = weeklyPeriod('2026-11-08', 'Asia/Shanghai', new Date('2026-11-10T12:00Z'));
  assert.equal(week.startDate, '2026-11-02');
  assert.equal(week.endDate, '2026-11-08');
  assert.equal(week.start, '2026-11-01T16:00:00.000Z');
  assert.equal(inWeek(week.start, week), true);
  assert.equal(inWeek(week.end, week), false);
  const dst = weeklyPeriod('2026-03-08', 'America/New_York', new Date('2026-03-20T12:00Z'));
  assert.equal((Date.parse(dst.end) - Date.parse(dst.start)) / 3600000, 167);
  assert.throws(() => weeklyPeriod('2026-02-31'), /有效的周次/);
});
test('统计真实记录，复习自评不改写为掌握率，空周不调用模型', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const summary = await f.store.addSummary(f.note.id, { study: studyFixture, text: '主动回忆' });
  await f.learning.enroll({ id: f.note.id, summaryId: summary.id, questionId: 'q1' });
  const card = Object.values(f.learning.data.cards)[0];
  await f.learning.review({
    cardId: card.id,
    version: 0,
    eventId: 'review-now',
    grade: 3,
    answer: '先尝试解释，再核对遗漏。',
  });
  const overview = await f.runtime.execute({ action: 'weekly.overview', timeZone: 'Asia/Shanghai' });
  assert.equal(overview.stats.newNotes, 1);
  assert.equal(overview.stats.summaries, 1);
  assert.equal(overview.stats.reviews, 1);
  assert.equal(overview.stats.reviewCards, 1);
  assert.equal(overview.stats.ratings.good, 1);
  assert.equal('mastery' in overview.stats, false);
  assert.equal('studyMinutes' in overview.stats, false);
  const empty = await f.runtime.execute({ action: 'weekly.overview', date: '2010-01-04' });
  assert.equal(empty.stats.reviews, 0);
  assert.equal(empty.sourceCount, 0);
  await assert.rejects(
    f.runtime.execute({ action: 'weekly.generate', date: '2010-01-04' }),
    /没有可用于回顾/,
  );
  assert.equal(f.calls(), 0);
  const task = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' }));
  assert.equal(task.status, 'done', task.error);
  const report = await f.runtime.execute({ action: 'weekly.get', id: task.result.reportId });
  assert.equal(report.value.stats.reviews, 1);
  assert.ok(report.value.knowledgeSummary.points.length);
  assert.equal(report.value.reviewQuestions.length, 1);
  assert.ok(isRemoteJsonValue(report));
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).stats.analyses, 0);
  await f.runtime.execute({ action: 'weekly.deleted', id: report.id, deleted: true });
  assert.equal((await f.runtime.execute({ action: 'weekly.get', id: report.id })).value, null);
  await f.runtime.execute({ action: 'weekly.deleted', id: report.id, deleted: false });
  assert.equal(
    (await f.runtime.execute({ action: 'weekly.get', id: report.id })).value.title,
    '本周学习回顾',
  );
});

test('周报逐题复习保存回答、更新计划，重复提交不重复记录，停用卡片不重新启用', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const job = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' })),
    id = job.result.reportId;
  assert.equal((await f.runtime.execute({ action: 'weekly.reviewSession', id })).questions[0].card, null);
  const enrolled = await f.runtime.execute({ action: 'weekly.enroll', id, index: 0 });
  assert.ok(isRemoteJsonValue(enrolled));
  assert.deepEqual(enrolled.card.tasks, ['说明核对的作用']);
  const request = {
    action: 'weekly.grade',
    id,
    index: 0,
    version: 0,
    grade: 3,
    answer: '通过核对找到遗漏与适用边界。',
    eventId: 'weekly-attempt-1',
  };
  const result = await f.runtime.execute(request);
  assert.equal(result.card.version, 1);
  assert.equal(result.card.lastAnswer, request.answer);
  assert.equal((await f.runtime.execute(request)).duplicate, true);
  assert.equal(f.learning.data.reviews.length, 1);
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).stats.reviews, 1);
  await f.learning.suspendReview({ cardId: result.card.id, suspended: true });
  assert.equal((await f.runtime.execute({ action: 'weekly.enroll', id, index: 0 })).card.suspended, true);
  assert.equal(
    (await f.runtime.execute({ action: 'weekly.reviewSession', id })).questions[0].card.suspended,
    true,
  );
  await assert.rejects(f.runtime.execute({ ...request, eventId: 'another', version: 1 }), /不再出现/);
  assert.equal(f.learning.data.reviews.length, 1);
  await f.runtime.execute({ action: 'weekly.deleted', id, deleted: true });
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).stats.reviews, 1);
});

test('周报复习题限制在八题以内，并拒绝把用户的错误作答当成答案依据', async (t) => {
  const tooMany = await fixture(
    (value) => (value.reviewQuestions = Array.from({ length: 9 }, () => value.reviewQuestions[0])),
  );
  t.after(() => tooMany.runtime.dispose());
  assert.equal(
    (await done(tooMany.runtime, await tooMany.runtime.execute({ action: 'weekly.generate' }))).status,
    'error',
  );
  const f = await fixture((value, records) => {
    if (records[0].kind === 'review')
      value.reviewQuestions[0].evidence = [{ sourceId: records[0].id, quote: '读过就说明已经完全掌握' }];
  });
  t.after(() => f.runtime.dispose());
  const summary = await f.store.addSummary(f.note.id, { study: studyFixture, text: '主动回忆' });
  await f.learning.enroll({ id: f.note.id, summaryId: summary.id, questionId: 'q1' });
  const card = Object.values(f.learning.data.cards)[0];
  await f.learning.review({
    cardId: card.id,
    version: 0,
    eventId: 'mistaken-answer',
    grade: 3,
    answer: '读过就说明已经完全掌握',
  });
  const old = await f.store.read(f.note.id);
  old.createdAt = old.updatedAt = '2010-01-01T00:00:00Z';
  old.summaries[0].createdAt = old.createdAt;
  await atomicWrite(f.store.boardPath(old.id), old);
  const job = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' }));
  assert.equal(job.status, 'error');
  assert.match(job.error, /不能只依据用户作答/);
  assert.equal((await f.runtime.repositories.reports.list()).length, 0);
});

test('仅有周报复习记录时可再次总结，引用链保持扁平并随原来源删除暂停', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const first = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' }));
  await f.runtime.execute({
    action: 'weekly.grade',
    id: first.result.reportId,
    index: 0,
    version: 0,
    grade: 3,
    answer: '独立解释，再检查。',
    eventId: 'first-week-review',
  });
  const old = await f.store.read(f.note.id);
  old.createdAt = old.updatedAt = '2010-01-01T00:00:00Z';
  await atomicWrite(f.store.boardPath(old.id), old);
  const second = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' }));
  assert.equal(second.status, 'done', second.error);
  const graded = await f.runtime.execute({
    action: 'weekly.grade',
    id: second.result.reportId,
    index: 0,
    version: 0,
    grade: 2,
    answer: '条件还需要补充。',
    eventId: 'second-week-review',
  });
  assert.ok(graded.card.sourceRefs.some((ref) => ref.weeklyReportId === first.result.reportId));
  assert.equal((await f.learning.dashboard()).total, 2);
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).stats.reviews, 2);
  await f.runtime.execute({ action: 'weekly.deleted', id: first.result.reportId, deleted: true });
  assert.equal((await f.learning.dashboard()).total, 0);
  await f.runtime.execute({ action: 'weekly.deleted', id: first.result.reportId, deleted: false });
  assert.equal((await f.learning.dashboard()).total, 2);
  old.scene.elements = [];
  await atomicWrite(f.store.boardPath(old.id), old);
  assert.equal((await f.learning.dashboard()).total, 0);
});
test('周报能引用系统学习，删除原始笔记时连带清理间接派生周报', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const old = await f.store.read(f.note.id);
  old.createdAt = old.updatedAt = '2010-01-01T00:00:00Z';
  await atomicWrite(f.store.boardPath(old.id), old);
  const sources = f.runtime.sources.budget(await f.runtime.sources.noteRecords(old.id));
  await f.runtime.reports.save(
    'systemStudy',
    { title: '学习机制', overview: '主动回忆通过解释与核对发现知识遗漏。' },
    sources,
    { noteIds: [old.id], materialIds: [] },
    { name: '验证模型' },
    { key: old.id },
  );
  const overview = await f.runtime.execute({ action: 'weekly.overview' });
  assert.equal(overview.stats.analyses, 1);
  const task = await done(f.runtime, await f.runtime.execute({ action: 'weekly.generate' }));
  assert.equal(task.status, 'done', task.error);
  const report = await f.runtime.execute({ action: 'weekly.get', id: task.result.reportId });
  assert.ok(report.sources.every((s) => s.reportId));
  assert.equal(report.unavailable, false);
  await f.runtime.purge([old.id]);
  assert.equal((await f.runtime.repositories.reports.list()).length, 0);
});
test('关闭周报拒绝生成，恢复开关后已有记录仍可查看', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.execute({ action: 'features.update', features: { weekly: false } });
  await assert.rejects(
    f.runtime.execute({ action: 'weekly.generate' }),
    (e) => e.code === 'FEATURE_DISABLED',
  );
  assert.equal(f.calls(), 0);
  await f.runtime.execute({ action: 'features.update', features: { weekly: true } });
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).stats.newNotes, 1);
});

test('旧系统学习中的本周文字修订纳入回顾，移动排版不冒充理解变化', async (t) => {
  const f = await fixture();
  t.after(() => f.runtime.dispose());
  const old = await f.store.read(f.note.id);
  old.createdAt = old.updatedAt = '2010-01-01T00:00:00Z';
  await atomicWrite(f.store.boardPath(old.id), old);
  const sources = f.runtime.sources.budget(await f.runtime.sources.noteRecords(old.id));
  const report = await f.runtime.reports.save(
    'systemStudy',
    { title: '早期学习', overview: '主动回忆通过解释与核对发现知识遗漏。' },
    sources,
    { noteIds: [old.id], materialIds: [] },
    { name: '验证模型' },
    { key: old.id, createdAt: old.createdAt },
  );
  const base = {
    id: report.id,
    noteId: old.id,
    revision: 1,
    updatedAt: new Date().toISOString(),
    scene: {
      elements: [
        {
          id: 'edit',
          type: 'text',
          x: 0,
          y: 0,
          text: '必须比较反例并核对适用条件。',
          customData: { systemStudy: { itemId: 'core:a', originalText: '看过资料就已掌握。' } },
        },
      ],
      files: {},
      appState: {},
    },
  };
  await f.runtime.repositories['study-canvases'].put(report.id, base);
  const overview = await f.runtime.execute({ action: 'weekly.overview' });
  assert.equal(overview.stats.analyses, 0);
  assert.equal(overview.sourceCount, 1);
  assert.equal(overview.activities[0].kind, 'studyEdit');
  const records = await f.runtime.sources.reportRecords(report.id);
  assert.match(records.find((r) => r.kind === 'learning-edit').text, /我的修改：必须比较反例/);
  base.scene.elements[0].text = '看过资料就已掌握。';
  base.scene.elements[0].x = 900;
  await f.runtime.repositories['study-canvases'].put(report.id, base);
  assert.equal((await f.runtime.execute({ action: 'weekly.overview' })).sourceCount, 0);
});
