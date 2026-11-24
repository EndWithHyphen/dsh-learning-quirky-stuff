import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { TOPIC_SCHEMA } from '../server/modules/topics.js';
import { PREVIEW_SCHEMA } from '../server/modules/materials.js';
import { PAGE_STUDY_SCHEMA } from '../server/page-study.js';
import { pageStudyResult } from './page-study-fixture.mjs';
import { FEEDBACK_SCHEMA } from '../server/modules/feedback.js';
import { EXPLORE_SCHEMA } from '../server/modules/explore.js';
import { parseSubtitles } from '../shared/material-text.js';
import { parseArticle, isPublicAddress, fetchPublicDocument } from '../server/integrations/web-reader.js';
import { inkSignature } from '../shared/ink.js';
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol';
import { FeatureConfig } from '../server/config.js';
import { TaskManager } from '../server/task-manager.js';
import { codexArgs } from '../codex-provider.js';
import { FEATURE_IDS } from '../shared/features.js';

const passage = '主动回忆要求先尝试复述，再回到原文核对遗漏。';
const other = '间隔复习将回忆安排到不同时间，依据表现调整下一次复习。';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
function inputs(prompt) {
  const index = prompt.lastIndexOf('资料：'),
    tail = prompt.slice(index + 3);
  return JSON.parse(tail.slice(0, tail.indexOf('\n输出')));
}
function fakeGateway() {
  return {
    async json(options) {
      if (options.webSearch)
        return {
          value: {
            candidates: [
              {
                topic: '间隔与提取',
                direction: 'foundation',
                reason: '理解关键机制',
                urls: ['https://example.test/learning'],
              },
            ],
          },
          model: { id: 'fixture', name: '测试模型', provider: 'fixture' },
        };
      const records = inputs(options.prompt),
        evidence = [{ sourceId: records[0].id, quote: records[0].text }],
        claim = { text: '先回忆再核对，借助反馈发现遗漏。', evidence };
      let value;
      if (options.schema === TOPIC_SCHEMA)
        value = {
          title: '有效学习',
          overview: claim,
          points: [{ title: '核心机制', body: claim }],
          agreements: [],
          differences: [],
          gaps: [],
          changes: [],
          diagram: { title: '', kind: 'flow', nodes: [], edges: [], caption: '' },
          reviewQuestions: [{ prompt: '主动回忆的关键顺序是什么？', answer: '先回忆，再核对。', evidence }],
        };
      else if (options.schema === PREVIEW_SCHEMA)
        value = {
          question: '如何有效复习？',
          overview: claim,
          newPoints: [claim],
          alreadyRecorded: [],
          differences: [],
          readingPlan: [{ title: '关键段落', reason: '说明核心机制', sourceIds: [records[0].id] }],
          limitations: '',
        };
      else if (options.schema === FEEDBACK_SCHEMA)
        value = {
          overview: '已抓住部分要点，仍可补充核对环节。',
          strengths: [],
          gaps: [{ point: '核对遗漏', reason: '帮助找到理解缺口', evidence }],
          corrections: [],
          nextStep: '合上资料再复述一次。',
          reviewQuestions: [{ prompt: '为什么回忆后还要核对？', answer: '核对可发现遗漏。', evidence }],
        };
      else if (options.schema === EXPLORE_SCHEMA)
        value = {
          overview: '从回忆延伸到间隔安排。',
          recommendations: [
            {
              topic: '间隔与提取',
              direction: 'foundation',
              connection: claim,
              gain: '理解时间安排与记忆提取的联系',
              prerequisites: [],
              estimatedMinutes: 15,
              boundaries: '按具体材料调整',
              sourceIds: [records[0].id],
            },
          ],
        };
      else throw new Error('unknown schema');
      return {
        value,
        model: { id: 'fixture', name: '测试模型', provider: 'fixture', reasoningEffort: null },
      };
    },
  };
}
async function fixture(overrides = {}) {
  const store = await new LibraryStore(await mkdtemp(join(tmpdir(), 'study-modules-'))).init(),
    learning = await new LearningStore(store).init(),
    runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
      gateway: fakeGateway(),
      native: { read: async () => ({ lines: [{ text: '检索图片中的知识线索', confidence: 0.9 }] }) },
      web: {
        read: async (url) => ({
          url,
          title: '公开材料',
          kind: 'article',
          blocks: [{ text: passage }],
          completeness: 'full',
        }),
      },
      ...overrides,
    }).init();
  const note = await store.create({ title: '学习笔记', source: { url: 'https://example.test/note' } });
  await store.save({
    id: note.id,
    baseRevision: 0,
    scene: {
      elements: [
        { id: 'text', type: 'text', x: 0, y: 0, text: passage, width: 300, height: 100, version: 1 },
      ],
      files: {},
      appState: {},
    },
  });
  return { store, learning, runtime, note };
}
async function completed(runtime, job) {
  for (let i = 0; i < 300; i++) {
    const current = runtime.tasks.get(job.id);
    if (!['queued', 'running'].includes(current.status)) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('task did not settle');
}

test('学习功能开关独立持久化，关闭后后台也拒绝新操作，重新开启资料仍在', async () => {
  const { store, runtime } = await fixture();
  const topic = await runtime.execute({ action: 'topics.save', title: '专题', noteIds: [] });
  assert.equal(
    Object.values((await runtime.execute({ action: 'features.get' })).features).filter(Boolean).length,
    FEATURE_IDS.length,
  );
  await runtime.execute({ action: 'features.update', features: { topics: false } });
  await assert.rejects(
    runtime.execute({ action: 'topics.list' }),
    (error) => error.code === 'FEATURE_DISABLED',
  );
  assert.ok(await runtime.execute({ action: 'materials.list' }));
  await runtime.dispose();
  const learning = await new LearningStore(store).init(),
    next = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning).init();
  assert.equal(next.config.enabled('topics'), false);
  await next.execute({ action: 'features.update', features: { topics: true } });
  assert.equal((await next.execute({ action: 'topics.list' }))[0].id, topic.id);
  await next.dispose();
});

test('删除专题隐藏其整理与复习，恢复专题后保留原内容与进度', async () => {
  const { runtime, learning, note } = await fixture();
  const topic = await runtime.execute({ action: 'topics.save', title: '专题删除验证', noteIds: [note.id] });
  await completed(runtime, await runtime.execute({ action: 'topics.generate', id: topic.id }));
  const { report } = await runtime.execute({ action: 'topics.get', id: topic.id });
  await runtime.execute({ action: 'topics.enroll', reportId: report.id, index: 0 });
  assert.equal((await learning.dashboard()).total, 1);
  await runtime.execute({ action: 'topics.save', id: topic.id, deleted: true });
  assert.equal((await runtime.reports.get(report.id)).unavailable, true);
  assert.equal((await runtime.sources.reportRecords(report.id)).length, 0);
  assert.equal((await learning.dashboard()).total, 0);
  await runtime.execute({ action: 'topics.save', id: topic.id, deleted: false });
  assert.equal((await runtime.reports.get(report.id)).value.reviewQuestions.length, 1);
  assert.equal((await learning.dashboard()).total, 1);
  await runtime.dispose();
});

test('伪造引文拒绝保存，不把模型猜测变成有来源的整理', async () => {
  const normal = fakeGateway();
  const { runtime, note } = await fixture({
    gateway: {
      async json(options) {
        const result = await normal.json(options);
        result.value.overview.evidence[0].quote = '原文从未出现的断言';
        return result;
      },
    },
  });
  const topic = await runtime.execute({ action: 'topics.save', title: '引用校验', noteIds: [note.id] });
  const job = await completed(runtime, await runtime.execute({ action: 'topics.generate', id: topic.id }));
  assert.equal(job.status, 'error');
  assert.match(job.error, /依据与原文不一致/);
  assert.equal((await runtime.repositories.reports.list()).length, 0);
  await runtime.dispose();
});

test('配置损坏时保留原文件，隔离新模块且不影响读取白板', async () => {
  const { store, runtime, note } = await fixture();
  await runtime.dispose();
  const file = join(store.root, 'modules', 'settings.json');
  await writeFile(file, '{broken settings');
  const config = await new FeatureConfig(store.root).init();
  assert.equal(Object.values(config.get().features).some(Boolean), false);
  assert.match(config.get().error, /原文件已保留/);
  await assert.rejects(config.update({ features: { topics: true } }), /未覆盖原文件/);
  assert.equal(await readFile(file, 'utf8'), '{broken settings');
  assert.equal((await store.read(note.id)).title, note.title);
});

test('排队任务可取消；超时与重启中断保留不同的原因', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-tasks-'));
  const config = await new FeatureConfig(root).init();
  const tasks = await new TaskManager(root, config, { concurrency: 1, timeoutMs: 25 }).init();
  const first = await tasks.start({
    feature: 'topics',
    title: '等待模型',
    key: 'one',
    run: (job) =>
      new Promise((resolve, reject) =>
        job.signal.addEventListener('abort', () => reject(job.signal.reason), { once: true }),
      ),
  });
  let ran = false;
  const queued = await tasks.start({
    feature: 'explore',
    title: '排队',
    key: 'two',
    run: async () => {
      ran = true;
    },
  });
  await tasks.cancel(queued.id);
  assert.equal(tasks.get(queued.id).status, 'cancelled');
  const result = await completed({ tasks }, first);
  assert.equal(result.errorCode, 'TASK_TIMEOUT');
  assert.equal(result.status, 'error');
  assert.equal(ran, false);
  await tasks.dispose();
  const id = randomUUID();
  await tasks.repository.put(id, {
    id,
    feature: 'preview',
    key: 'interrupted',
    references: {},
    status: 'running',
    createdAt: new Date().toISOString(),
  });
  const restarted = await new TaskManager(root, config).init();
  assert.equal(restarted.get(id).status, 'interrupted');
  assert.match(restarted.get(id).error, /重启/);
  await restarted.dispose();
});

test('联网探索显式启用搜索，其余生成继续关闭联网与执行工具', () => {
  const offline = codexArgs('/tmp', 'schema', 'output', [], 'chosen-model', 'max');
  const online = codexArgs('/tmp', 'schema', 'output', [], 'chosen-model', 'max', 'live');
  assert.ok(offline.includes('web_search="disabled"'));
  assert.ok(online.includes('web_search="live"'));
  assert.ok(online.some((value, i) => value === '--enable' && online[i + 1] === 'code_mode_host'));
  assert.ok(offline.some((value, i) => value === '--disable' && offline[i + 1] === 'code_mode_host'));
  for (const args of [offline, online]) {
    assert.ok(args.includes('--ignore-user-config'));
    for (const name of ['shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use'])
      assert.ok(args.some((value, i) => value === '--disable' && args[i + 1] === name));
    assert.equal(args[args.indexOf('--model') + 1], 'chosen-model');
  }
});
test('关闭功能会取消进行中的生成，迟到的模型结果不会保存', async () => {
  let release, entered;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve)),
    normal = fakeGateway();
  const { runtime, note } = await fixture({
    gateway: {
      json: async (options) => {
        entered();
        await gate;
        return normal.json(options);
      },
    },
  });
  const topic = await runtime.execute({ action: 'topics.save', title: '专题', noteIds: [note.id] }),
    job = await runtime.execute({ action: 'topics.generate', id: topic.id });
  await started;
  await runtime.execute({ action: 'features.update', features: { topics: false } });
  release();
  const done = await completed(runtime, job);
  assert.equal(done.status, 'cancelled');
  assert.equal((await runtime.repositories.reports.list()).length, 0);
  await runtime.dispose();
});
test('专题整理有来源、包含复习题，新增资料后提示更新，并能进入复习', async () => {
  const { runtime, store, learning, note } = await fixture(),
    topic = await runtime.execute({ action: 'topics.save', title: '有效学习', noteIds: [note.id] });
  const done = await completed(runtime, await runtime.execute({ action: 'topics.generate', id: topic.id }));
  assert.equal(done.status, 'done', done.error);
  const detail = await runtime.execute({ action: 'topics.get', id: topic.id });
  assert.equal(detail.report.value.reviewQuestions.length, 1);
  assert.equal(detail.report.value.overview.evidence[0].boardId, note.id);
  assert.equal(detail.needsUpdate, false);
  assert.equal(isRemoteJsonValue(detail), true);
  await runtime.execute({ action: 'topics.enroll', reportId: detail.report.id, index: 0 });
  assert.equal((await learning.dashboard()).total, 1);
  const board = await store.read(note.id);
  board.scene.elements[0].text += '新增了学习条件。';
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  assert.equal((await runtime.execute({ action: 'topics.get', id: topic.id })).needsUpdate, true);
  await runtime.dispose();
});
test('截图与手写识别能搜索并返回元素和视频位置，手工修正立即生效', async () => {
  const { runtime, store, note } = await fixture();
  const { image } = await store.dispatch({
    action: 'addWebImage',
    id: note.id,
    url: note.source.url,
    requestId: 'module-image-001',
    dataURL: png,
    width: 1,
    height: 1,
    videoTime: 95,
  });
  let board = await store.read(note.id);
  board.scene.elements.push({
    id: 'ink',
    type: 'freedraw',
    x: 5,
    y: 5,
    width: 20,
    height: 20,
    version: 1,
    points: [
      [0, 0],
      [20, 20],
    ],
  });
  await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
  board = await store.read(note.id);
  const job = await runtime.execute({
    action: 'search.index',
    noteIds: [note.id],
    ink: {
      [note.id]: { signature: inkSignature(board.scene), chunks: [{ elementIds: ['ink'], dataURL: png }] },
    },
  });
  assert.equal((await completed(runtime, job)).status, 'done');
  const result = await runtime.execute({ action: 'search.query', query: '知识线索' });
  assert.ok(
    result.matches.some(
      (match) =>
        match.kind === 'image' && match.locator.elementIds[0] === image.id && match.locator.seconds === 95,
    ),
  );
  assert.ok(
    result.matches.some((match) => match.kind === 'handwriting' && match.locator.elementIds[0] === 'ink'),
  );
  await runtime.execute({
    action: 'search.correct',
    id: note.id,
    imageId: image.id,
    text: '手工修正后的专有名词',
  });
  assert.ok(
    (await runtime.execute({ action: 'search.query', query: '专有名词' })).matches.some((match) =>
      match.locator.elementIds.includes(image.id),
    ),
  );
  await runtime.dispose();
});
test('字幕保留时间点，材料预览定位到实际段落，报告失去来源后隐藏', async () => {
  const { runtime } = await fixture();
  const material = await runtime.execute({
    action: 'materials.capture',
    title: '字幕',
    text: '1\n00:00:05,000 --> 00:00:12,000\n' + passage + '\n\n2\n00:00:12,000 --> 00:00:20,000\n' + other,
  });
  assert.equal(material.blocks[1].seconds, 12);
  const done = await completed(
    runtime,
    await runtime.execute({ action: 'materials.preview', id: material.id }),
  );
  assert.equal(done.status, 'done', done.error);
  const result = await runtime.execute({ action: 'materials.get', id: material.id });
  assert.equal(result.report.value.readingPlan[0].sources[0].materialId, material.id);
  assert.equal(result.report.value.readingPlan[0].sources[0].locator.seconds, 5);
  await runtime.execute({ action: 'materials.delete', id: material.id });
  assert.equal((await runtime.reports.get(result.report.id)).unavailable, true);
  await runtime.dispose();
});
test('网页学习只总结指定页面，保存出处，复用同一结果并幂等加入今日复习', async (t) => {
  const calls = [];
  const { runtime, store, learning, note } = await fixture({
    gateway: {
      async json(options) {
        assert.equal(options.schema, PAGE_STUDY_SCHEMA);
        calls.push(options);
        return pageStudyResult(options);
      },
    },
  });
  t.after(() => runtime.dispose());
  await store.dispatch({
    action: 'saveWebNotes',
    id: note.id,
    url: note.source.url,
    baseVersion: 0,
    requestId: 'private-note-write',
    text: 'OTHER_PRIVATE_NOTES',
  });
  const request = {
    action: 'materials.capture',
    boardId: note.id,
    url: note.source.url,
    title: '测试网页',
    kind: 'article',
    blocks: [
      { text: other, domId: 'section-intro' },
      { text: passage, domId: 'section-two' },
    ],
  };
  const [material, copy] = await Promise.all([runtime.execute(request), runtime.execute(request)]);
  assert.equal(copy.id, material.id);
  const action = {
    action: 'materials.study',
    id: material.id,
    boardId: note.id,
    url: note.source.url,
    route: { provider: 'fixture', model: 'fixture' },
  };
  await assert.rejects(runtime.execute({ ...action, url: 'https://example.test/wrong' }), /不属于/);
  const task = await completed(runtime, await runtime.execute(action));
  assert.equal(task.status, 'done', task.error);
  const { studyReport, report } = await runtime.execute({ action: 'materials.get', id: material.id });
  assert.equal(report, null);
  assert.equal(studyReport.id, task.result.reportId);
  assert.equal(studyReport.value.partial, false);
  assert.equal(studyReport.value.points[0].body.evidence[0].locator.domId, 'section-two');
  assert(calls[0].prompt.includes(other) && calls[0].prompt.includes(passage));
  assert(!calls[0].prompt.includes('OTHER_PRIVATE_NOTES'));
  assert(!calls[0].webSearch);
  assert.equal((await completed(runtime, await runtime.execute(action))).result.reportId, studyReport.id);
  assert.equal(calls.length, 1);
  const enroll = { ...action, action: 'materials.enrollStudy', reportId: studyReport.id };
  assert.equal((await runtime.execute(enroll)).added, 1);
  assert.equal((await runtime.execute(enroll)).added, 0);
  const [card] = (await learning.dashboard()).cards;
  assert.equal(card.answer, studyReport.value.reviewQuestions[0].answer);
  assert.equal(card.origin.id, studyReport.id);
  await runtime.execute({ action: 'materials.delete', id: material.id });
  assert.equal((await learning.dashboard()).total, 0);
  await assert.rejects(runtime.execute(enroll), /已删除/);
});

test('网址一键总结对长文标明选段，保留首尾来源；无法读取或引用失实时不保存总结', async (t) => {
  let calls = 0,
    invalid = false;
  const { runtime } = await fixture({
    web: {
      async read(url) {
        if (url.endsWith('/empty')) return { url, title: '空网页', blocks: [] };
        return {
          url,
          title: '长文',
          kind: 'article',
          completeness: 'full',
          blocks: Array.from({ length: 120 }, (_, i) => ({ text: '段落' + i + ' ' + passage.repeat(30) })),
        };
      },
    },
    gateway: {
      async json(options) {
        calls++;
        const parsed = inputs(options.prompt);
        assert.equal(parsed.length, 100);
        assert(parsed[0].text.startsWith('段落0 ') && parsed.at(-1).text.startsWith('段落119 '));
        assert(parsed.reduce((n, s) => n + s.text.length, 0) <= 48000);
        const result = pageStudyResult(options);
        if (invalid) result.value.points[0].body.evidence[0].quote = '捏造的引文';
        return result;
      },
    },
  });
  t.after(() => runtime.dispose());
  const start = (path) =>
    runtime.execute({ action: 'materials.studyUrl', url: 'https://example.test/' + path });
  const empty = await completed(runtime, await start('empty'));
  assert.equal(empty.status, 'error');
  assert.equal(calls, 0);
  const done = await completed(runtime, await start('long'));
  assert.equal(done.status, 'done', done.error);
  const report = await runtime.reports.get(done.result.reportId);
  assert.equal(report.value.partial, true);
  assert.equal(report.scope.noteIds.length, 0);
  const enrollment = await runtime.execute({
    action: 'materials.enrollStudy',
    id: done.result.materialId,
    reportId: report.id,
  });
  assert.equal(enrollment.added, 1);
  invalid = true;
  const bad = await completed(runtime, await start('other'));
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /原文不一致/);
  assert.equal((await runtime.repositories.reports.list()).length, 1);
  const imported = await runtime.execute({ action: 'materials.list' });
  assert.equal(imported.find((m) => m.url.endsWith('/other')).latestStudyId, null);
  await assert.rejects(
    runtime.execute({
      action: 'materials.enrollStudy',
      id: imported.find((m) => m.url.endsWith('/other')).id,
      reportId: report.id,
    }),
    /来源/,
  );
});
test('同一网页按模板及其版本分别生成与复用，老总结作为默认模板保留', async (t) => {
  const calls = [];
  const { runtime } = await fixture({
    gateway: {
      async json(options) {
        calls.push(options.prompt);
        return pageStudyResult(options);
      },
    },
  });
  t.after(() => runtime.dispose());
  const material = await runtime.execute({ action: 'materials.capture', title: '学习原文', text: passage });
  const start = (templateId) => runtime.execute({ action: 'materials.study', id: material.id, templateId });
  const run = async (id) => {
    const finished = await completed(runtime, await start(id));
    assert.equal(finished.status, 'done', finished.error);
    return finished.result.reportId;
  };
  const standard = await run(undefined);
  await runtime.repositories.materials.update(material.id, ({ studyVersions, ...old }) => old);
  await runtime.repositories.reports.update(standard, ({ template, ...old }) => old);
  assert.equal(await run('default'), standard);
  const first = { id: 'lectures', revision: 0, name: '我的复述', prompt: '按照小组讨论的顺序，先解释假设。' };
  const update = (change) => runtime.execute({ action: 'features.update', summaryTemplate: change });
  await update(first);
  const [custom, preset] = await Promise.all([run(first.id), run('recall')]);
  assert.notEqual(custom, preset);
  assert.equal(await run(first.id), custom);
  assert.equal(await run('default'), standard);
  assert.equal(calls.length, 3);
  assert(calls.some((p) => p.includes(first.prompt)));
  await update({ ...first, prompt: '换用两个案例比较。', revision: 1 });
  const revised = await run(first.id);
  assert.notEqual(revised, custom);
  assert(calls.at(-1).includes('换用两个案例比较。'));
  const detail = await runtime.execute({ action: 'materials.get', id: material.id, studyId: custom });
  assert.equal(detail.studyVersions.length, 4);
  assert.equal(detail.studyReport.template.prompt, first.prompt);
  assert.equal(detail.studyReport.template.revision, 1);
  assert.equal((await runtime.backup()).settings.summaryTemplates[0].revision, 2);
  await update({ id: first.id, revision: 2, remove: true });
  await assert.rejects(start(first.id), /不存在/);
  assert.equal((await runtime.reports.get(revised)).template.revision, 2);
  assert.equal(calls.length, 4);
  const common = '术语旁标注英文。';
  await runtime.execute({
    action: 'features.update',
    summaryTemplateCommon: { revision: 0, prompt: common },
  });
  const updatedDefault = await run('default');
  assert.notEqual(updatedDefault, standard);
  assert(calls.at(-1).includes(common));
  assert.equal(await run('default'), updatedDefault);
  assert.equal(calls.length, 5);
});

test('取消网页总结会丢弃迟到的模型结果，已读取的材料仍可重试', async (t) => {
  let enter, finish;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const { runtime } = await fixture({
    gateway: {
      async json(options) {
        enter();
        await gate;
        return pageStudyResult(options);
      },
    },
  });
  t.after(() => {
    finish();
    return runtime.dispose();
  });
  const material = await runtime.execute({ action: 'materials.capture', text: passage });
  const action = { action: 'materials.study', id: material.id };
  const task = await runtime.execute(action);
  await entered;
  assert.equal((await runtime.execute(action)).id, task.id);
  await runtime.execute({ action: 'tasks.cancel', id: task.id });
  finish();
  assert.equal((await completed(runtime, task)).status, 'cancelled');
  assert.equal((await runtime.execute({ action: 'materials.get', id: material.id })).studyReport, null);
  assert.equal((await completed(runtime, await runtime.execute(action))).status, 'done');
});
test('理解反馈能归档并将针对性问题加入复习，来源删除后复习暂停', async () => {
  const { runtime, learning, store, note } = await fixture();
  const done = await completed(
    runtime,
    await runtime.execute({
      action: 'feedback.start',
      boardId: note.id,
      mode: 'summary',
      answer: '我会先尝试回答。',
    }),
  );
  assert.equal(done.status, 'done', done.error);
  const report = await runtime.execute({ action: 'feedback.get', id: done.result.reportId });
  assert.equal(report.value.reviewQuestions.length, 1);
  await runtime.execute({ action: 'feedback.enroll', id: report.id, index: 0 });
  assert.equal((await learning.dashboard()).total, 1);
  await runtime.execute({ action: 'feedback.resolve', id: report.id, resolved: true });
  assert.equal((await runtime.execute({ action: 'feedback.get', id: report.id })).value.resolved, true);
  await store.metadata({ id: note.id, deleted: true });
  assert.equal((await learning.dashboard()).total, 0);
  await runtime.dispose();
});
test('联网探索只使用成功读取的来源，待学清单去重并保存状态', async () => {
  const { runtime } = await fixture();
  const done = await completed(
    runtime,
    await runtime.execute({ action: 'explore.start', focus: '有效学习', mode: 'web' }),
  );
  assert.equal(done.status, 'done', done.error);
  const report = await runtime.execute({ action: 'explore.report', id: done.result.reportId });
  assert.ok(report.value.recommendations[0].sources[0].url.startsWith('https://example.test'));
  const entry = await runtime.execute({ action: 'explore.add', reportId: report.id, recommendationId: 'r1' }),
    again = await runtime.execute({ action: 'explore.add', reportId: report.id, recommendationId: 'r1' });
  assert.equal(entry.id, again.id);
  await runtime.execute({ action: 'explore.update', id: entry.id, state: 'completed' });
  assert.equal((await runtime.execute({ action: 'explore.queue' }))[0].state, 'completed');
  await runtime.dispose();
});
test('公共网页读取拒绝内网地址，HTML 脚本不会执行，字幕识别稳定', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(isPublicAddress(ip), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(
    fetchPublicDocument('https://example.test/private', {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    /公共网站/,
  );
  const html =
      '<html><head><title>学习方法</title></head><body><article><h1>学习方法</h1><p>' +
      passage.repeat(30) +
      '</p></article><script>globalThis.__shouldNotRun=1</script></body></html>',
    article = parseArticle(html, 'https://example.test/article');
  assert.ok(article.blocks.some((block) => block.text.includes('主动回忆')));
  assert.equal(globalThis.__shouldNotRun, undefined);
  assert.equal(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:04.500\nhello')[0].seconds, 1);
});
test('模块备份和永久删除包含派生报告、材料、索引与任务记录', async () => {
  const { runtime, store, learning, note } = await fixture();
  const material = await runtime.execute({
      action: 'materials.capture',
      boardId: note.id,
      url: note.source.url,
      title: '绑定材料',
      text: passage,
    }),
    topic = await runtime.execute({
      action: 'topics.save',
      title: '专题',
      noteIds: [note.id],
      materialIds: [material.id],
    });
  await completed(runtime, await runtime.execute({ action: 'topics.generate', id: topic.id }));
  const before = await runtime.backup();
  assert.equal(before.reports.length, 1);
  await store.metadata({ id: note.id, deleted: true });
  await runtime.beforePurge([note.id]);
  await learning.purge({ ids: [note.id], confirm: true });
  await runtime.purge([note.id]);
  assert.equal((await runtime.repositories.reports.list()).length, 0);
  assert.equal((await runtime.repositories.materials.list()).length, 0);
  assert.equal((await runtime.tasks.repository.list()).length, 0);
  assert.deepEqual((await runtime.repositories.topics.get(topic.id)).noteIds, []);
  await runtime.dispose();
});

test('画布 OCR：缓存复用、人工校正、裁剪变更拒绝旧结果、关闭功能阻止识别', async () => {
  let reads = 0;
  const { store, runtime, note } = await fixture({
    native: {
      read: async () => {
        reads++;
        return { lines: [{ text: '识别文字', confidence: 0.9 }] };
      },
    },
  });
  try {
    const board = await store.read(note.id);
    await store.save({
      id: note.id,
      baseRevision: board.revision,
      scene: {
        ...board.scene,
        elements: [
          ...board.scene.elements,
          {
            id: 'ocr-image',
            type: 'image',
            fileId: 'image-file',
            x: 0,
            y: 100,
            width: 300,
            height: 200,
            version: 1,
          },
        ],
        files: { 'image-file': { id: 'image-file', dataURL: png, mimeType: 'image/png' } },
      },
    });
    const first = await completed(
      runtime,
      await runtime.execute({ action: 'search.recognizeImage', id: note.id, imageId: 'ocr-image' }),
    );
    assert.equal(first.status, 'done');
    assert.equal(first.result.text, '识别文字');
    await runtime.execute({
      action: 'search.confirmImage',
      id: note.id,
      imageId: 'ocr-image',
      hash: first.result.hash,
      text: '人工核对后的文字',
    });
    const cached = await runtime.execute({
      action: 'search.recognizeImage',
      id: note.id,
      imageId: 'ocr-image',
    });
    assert.equal(cached.result.text, '人工核对后的文字');
    assert.equal(reads, 1);
    const fresh = await store.read(note.id);
    fresh.scene.elements.find((e) => e.id === 'ocr-image').crop = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      naturalWidth: 2,
      naturalHeight: 2,
    };
    await store.save({ id: note.id, baseRevision: fresh.revision, scene: fresh.scene });
    await assert.rejects(
      runtime.execute({
        action: 'search.confirmImage',
        id: note.id,
        imageId: 'ocr-image',
        hash: first.result.hash,
        text: '旧图文字',
      }),
      /图片已变化/,
    );
    await runtime.execute({ action: 'features.update', features: { search: false } });
    await assert.rejects(
      runtime.execute({ action: 'search.recognizeImage', id: note.id, imageId: 'ocr-image' }),
      /已关闭/,
    );
  } finally {
    await runtime.dispose();
  }
});

test('画布 OCR：识别过程中删除图片，不写回过期结果', async () => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const { store, runtime, note } = await fixture({
    native: {
      read: async () => {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
        return { lines: [{ text: '旧图片' }] };
      },
    },
  });
  try {
    let board = await store.read(note.id);
    await store.save({
      id: note.id,
      baseRevision: board.revision,
      scene: {
        ...board.scene,
        elements: [
          { id: 'ocr-image', type: 'image', fileId: 'f', x: 0, y: 0, width: 10, height: 10, version: 1 },
        ],
        files: { f: { id: 'f', dataURL: png, mimeType: 'image/png' } },
      },
    });
    const job = await runtime.execute({ action: 'search.recognizeImage', id: note.id, imageId: 'ocr-image' });
    await started;
    board = await store.read(note.id);
    board.scene.elements[0].isDeleted = true;
    await store.save({ id: note.id, baseRevision: board.revision, scene: board.scene });
    release();
    const result = await completed(runtime, job);
    assert.equal(result.status, 'error');
    assert.equal(await runtime.repositories['search-index'].get(note.id, { optional: true }), null);
  } finally {
    release?.();
    await runtime.dispose();
  }
});
