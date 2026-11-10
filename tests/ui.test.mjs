import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { studyFixture } from './fixture.mjs';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'localStorage', 'MutationObserver'])
  globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
await mkdir('node_modules/.cache', { recursive: true });
await build({
  entryPoints: ['src/study-panel.jsx'],
  outfile: 'node_modules/.cache/study-panel-test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['react'],
  logLevel: 'silent',
});
const {
  default: StudyPanel,
  AnnotatedText,
  QuestionCard,
  StudyDiagram,
  Practice,
} = await import('../node_modules/.cache/study-panel-test.mjs');
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.getSelection()?.removeAllRanges();
});
test('自测默认隐藏答案，用户作答后才揭晓，可再次收起', () => {
  const q = studyFixture.questions[0],
    r = render(React.createElement(QuestionCard, { question: q }));
  assert.equal(r.queryByText(q.answer), null);
  fireEvent.change(r.getByRole('textbox', { name: '我的回答' }), { target: { value: '先回忆' } });
  fireEvent.click(r.getByRole('button', { name: '揭晓答案' }));
  assert.ok(r.getByText(q.answer));
  fireEvent.click(r.getByRole('button', { name: '收起答案' }));
  assert.equal(r.queryByText(q.answer), null);
});
test('结构化自测展示条件和分步任务，答案与核对要点在揭晓后出现', () => {
  const question = {
    ...studyFixture.questions[0],
    difficulty: 'intermediate',
    context: '给定升序数组 [2,4,4,7]，目标值为 4。',
    tasks: ['写出第一个匹配位置。', '解释重复元素为什么影响停止条件。'],
    checkpoints: ['返回的是索引 1。', '解释了向左继续收缩的理由。'],
  };
  const r = render(React.createElement(QuestionCard, { question }));
  assert.ok(r.getByText('题干与条件'));
  assert.ok(r.getByText(question.context));
  assert.ok(r.getByText(question.tasks[1]));
  assert.ok(r.getByText('进阶'));
  assert.equal(r.queryByText(question.checkpoints[0]), null);
  fireEvent.click(r.getByRole('button', { name: '揭晓答案' }));
  assert.ok(r.getByText('核对要点'));
  assert.ok(r.getByText(question.checkpoints[0]));
  fireEvent.click(r.getByRole('button', { name: '收起答案' }));
  assert.equal(r.queryByText(question.checkpoints[0]), null);
});
function selectText(r, end = 3) {
  const node = r.container.querySelector('.sb-readable-text span').firstChild;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(r.container.querySelector('.sb-readable-text'));
}
test('划线按钮打开可留空的备注框，确认前不保存，留空只划线', async () => {
  let request;
  const r = render(
    React.createElement(AnnotatedText, {
      text: '先尝试自己回答，再查看笔记。',
      blockId: 'concept:c1:explanation',
      summary: { id: 'summary', annotations: [] },
      boardId: 'board',
      api: async (method, data) => {
        request = data;
        return { annotations: [] };
      },
      onChange: () => {},
      onError: (e) => {
        throw e;
      },
    }),
  );
  selectText(r);
  assert.equal(r.queryByRole('button', { name: '高亮' }), null);
  assert.equal(r.queryByRole('button', { name: '备注' }), null);
  assert.equal(r.queryByRole('button', { name: '＋ 写备注' }), null);
  fireEvent.click(r.getByRole('button', { name: '划线' }));
  assert.ok(r.getByRole('textbox', { name: '备注（可选）' }));
  assert.equal(request, undefined);
  assert.equal(r.getByRole('button', { name: '保存划线' }).disabled, false);
  fireEvent.click(r.getByRole('button', { name: '保存划线' }));
  await waitFor(() => assert.ok(request));
  assert.equal(request.quote, '先尝试');
  assert.equal(request.end, 3);
  assert.equal(request.kind, 'underline');
  assert.equal(request.note, '');
});
test('输入备注与划线一起保存，取消不产生记录', async () => {
  const requests = [];
  const r = render(
    React.createElement(AnnotatedText, {
      text: '这是学习内容',
      blockId: 'overview',
      summary: { id: 's', annotations: [] },
      boardId: 'b',
      api: async (method, data) => {
        requests.push(data);
        return { annotations: [] };
      },
      onChange: () => {},
      onError: (e) => {
        throw e;
      },
    }),
  );
  selectText(r);
  fireEvent.click(r.getByRole('button', { name: '划线' }));
  fireEvent.click(r.getByRole('button', { name: '取消' }));
  assert.equal(requests.length, 0);
  selectText(r);
  fireEvent.click(r.getByRole('button', { name: '划线' }));
  fireEvent.change(r.getByRole('textbox', { name: '备注（可选）' }), { target: { value: ' 我的理解 ' } });
  fireEvent.click(r.getByRole('button', { name: '保存划线与备注' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].note, '我的理解');
  assert.equal(requests[0].kind, 'underline');
  assert.equal(requests[0].quote, '这是学');
});
test('旧高亮显示为划线，编辑时可以清除备注并保留划线', async () => {
  let request;
  const r = render(
    React.createElement(AnnotatedText, {
      text: '学习内容',
      blockId: 'overview',
      summary: {
        id: 's',
        annotations: [
          {
            id: 'a',
            blockId: 'overview',
            kind: 'highlight',
            start: 0,
            end: 2,
            quote: '学习',
            note: '旧备注',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      boardId: 'b',
      api: async (method, data) => {
        request = data;
        return { annotations: [] };
      },
      onChange: () => {},
      onError: (e) => {
        throw e;
      },
    }),
  );
  assert.equal(r.container.querySelectorAll('.sb-highlight').length, 0);
  assert.ok(r.container.querySelector('.sb-underline'));
  fireEvent.click(r.getByRole('button', { name: '编辑' }));
  fireEvent.change(r.getByRole('textbox', { name: '备注（可选）' }), { target: { value: '' } });
  fireEvent.click(r.getByRole('button', { name: '保存划线' }));
  await waitFor(() => assert.ok(request));
  assert.equal(request.annotationId, 'a');
  assert.equal(request.note, '');
  assert.equal(request.kind, 'underline');
});
test('学习界面呈现概念和图解，可针对 topic 发起拓展', async () => {
  const board = {
    id: 'b',
    summaries: [
      {
        id: 's',
        createdAt: new Date().toISOString(),
        study: studyFixture,
        text: '原文',
        annotations: [],
        model: 'test',
      },
    ],
  };
  let generated;
  const r = render(
    React.createElement(StudyPanel, {
      board,
      api: async (method) =>
        method === 'models'
          ? [{ provider: 'codex-local', id: 'default', name: '本机 Codex', vision: true }]
          : {},
      onError: (e) => {
        throw e;
      },
      onToast: () => {},
      onGenerate: async (options) => {
        generated = options;
        return { id: 'j', status: 'cancelled' };
      },
      onAddCard: () => {},
      onClose: () => {},
    }),
  );
  assert.ok(r.getByRole('heading', { name: '主动回忆', level: 1 }));
  assert.ok(r.getByRole('img', { name: '学习过程' }));
  assert.equal(r.queryByText('易错点与待确认'), null);
  fireEvent.click(r.getAllByRole('button', { name: '拓展 ↗' })[0]);
  await waitFor(() => assert.ok(r.getByRole('button', { name: '生成主题拓展' })));
  await waitFor(() => assert.equal(r.getByRole('button', { name: '生成主题拓展' }).disabled, false));
  fireEvent.click(r.getByRole('button', { name: '生成主题拓展' }));
  await waitFor(() => assert.equal(generated?.mode, 'expand'));
  assert.equal(generated.conceptId, 'c1');
  assert.ok(r.container.querySelector('.sb-concept .sb-expand-composer'));
  assert.equal(r.container.querySelector('.sb-study-title').textContent.includes('加入复习'), false);
});
test('图解用安全 SVG 元素呈现模型提供的节点与连线', () => {
  const r = render(React.createElement(StudyDiagram, { diagram: studyFixture.diagrams[0] }));
  assert.equal(r.container.querySelectorAll('svg [data-diagram-node]').length, 2);
  assert.ok(r.getByText('回忆', { selector: 'tspan' }));
  assert.ok(r.getByText('核对', { selector: 'tspan' }));
  assert.equal(r.container.querySelector('foreignObject'), null);
});

test('切换模型后立即记住，未生成也会在下次默认使用', async () => {
  const models = [
      { provider: 'dsh', id: 'first', name: '模型一', vision: true },
      { provider: 'codex-local', id: 'default', name: '本机 Codex', vision: true },
    ],
    props = {
      board: { id: 'b', summaries: [] },
      api: async () => models,
      onError: (e) => {
        throw e;
      },
      onToast: () => {},
      onGenerate: () => {},
      onAddCard: () => {},
      onClose: () => {},
    };
  let r = render(React.createElement(StudyPanel, props));
  await waitFor(() => assert.equal(r.getByRole('combobox', { name: '模型' }).options.length, 2));
  fireEvent.change(r.getByRole('combobox', { name: '模型' }), {
    target: { value: 'codex-local\ndefault'.replace('\\n', '\n') },
  });
  const chosen = 'codex-local\ndefault'.replace('\\n', '\n');
  assert.equal(localStorage.getItem('studyboard-model'), chosen);
  r.unmount();
  r = render(React.createElement(StudyPanel, props));
  await waitFor(() => assert.equal(r.getByRole('combobox', { name: '模型' }).value, chosen));
});
test('复习按钮位于题目区域，明确区分全部题与当前题', () => {
  const calls = [],
    questions = [studyFixture.questions[0], { ...studyFixture.questions[0], id: 'q2', prompt: '第二个问题' }];
  const r = render(
    React.createElement(Practice, {
      questions,
      concepts: studyFixture.concepts,
      onEnroll: (id) => calls.push(id),
    }),
  );
  assert.ok(r.getByText('对应知识点：主动回忆'));
  fireEvent.click(r.getByRole('button', { name: '全部加入复习 · 2 题' }));
  fireEvent.click(r.getByRole('button', { name: '将这道题加入复习' }));
  assert.deepEqual(calls, [undefined, 'q1']);
});
test('拓展原位展开，生成完成仍保留原主题，用户主动选择才切换结果', async () => {
  const original = {
    id: 's',
    createdAt: new Date().toISOString(),
    study: studyFixture,
    text: '原文',
    annotations: [],
    model: 'test',
  };
  const expanded = {
    ...original,
    id: 'expanded',
    kind: 'expand',
    study: { ...studyFixture, title: '拓展结果', overview: '拓展内容' },
  };
  let scrollCalls = 0;
  HTMLElement.prototype.scrollIntoView = () => {
    scrollCalls++;
  };
  const r = render(
    React.createElement(StudyPanel, {
      board: { id: 'b', summaries: [original] },
      api: async (method) =>
        method === 'models'
          ? [{ provider: 'test', id: 'model', name: '模型', vision: true }]
          : { id: 'j', status: 'done', summary: expanded },
      onError: (e) => {
        throw e;
      },
      onToast: () => {},
      onGenerate: async () => ({ id: 'j', status: 'running' }),
      onAddCard: () => {},
      onClose: () => {},
    }),
  );
  fireEvent.click(r.getAllByRole('button', { name: '拓展 ↗' })[0]);
  assert.ok(r.container.querySelector('.sb-concept .sb-expand-composer'));
  assert.equal(scrollCalls, 0);
  await waitFor(() => assert.equal(r.getByRole('button', { name: '生成主题拓展' }).disabled, false));
  fireEvent.click(r.getByRole('button', { name: '生成主题拓展' }));
  await waitFor(() => assert.ok(r.getByRole('button', { name: '查看完整拓展' })), { timeout: 3000 });
  assert.ok(r.getByRole('heading', { name: '主动回忆', level: 1 }));
  assert.equal(scrollCalls, 0);
  fireEvent.click(r.getByRole('button', { name: '查看完整拓展' }));
  assert.ok(r.getByRole('heading', { name: '拓展结果', level: 1 }));
});

test('图文专题优先展示主线图与原图，生成时自动附带复习要求', async () => {
  const topic = {
      ...studyFixture,
      version: 3,
      takeaways: ['一条贯穿全文的结论'],
      sourceFigures: [
        { id: 'f1', sourceId: 'S01', title: '原图关系', caption: '这张图解释关键联系', conceptIds: ['c1'] },
      ],
      insights: [{ id: 'i1', title: '进一步的判断', text: '由两种机制共同推出的结论', conceptIds: ['c1'] }],
      scopeNote: '仅依据所给材料。',
      diagrams: [{ ...studyFixture.diagrams[0], placement: 'overview' }],
      questions: [],
    },
    summary = {
      id: 's',
      createdAt: new Date().toISOString(),
      model: 'gpt-6-astra',
      provider: 'codex-local',
      reasoningEffort: 'max',
      study: topic,
      annotations: [],
      assets: { S01: { dataURL: 'data:image/png;base64,AAAA' } },
    };
  let generated;
  const r = render(
    React.createElement(StudyPanel, {
      board: { id: 'b', summaries: [summary] },
      api: async (method) =>
        method === 'models'
          ? [
              {
                provider: 'codex-local',
                id: 'gpt-6-astra',
                name: 'Codex · GPT-6-Astra',
                configured: true,
                reasoningEffort: 'max',
                vision: true,
              },
            ]
          : null,
      onError: (e) => {
        throw e;
      },
      onToast: () => {},
      onGenerate: async (options) => {
        generated = options;
        return { id: 'j', status: 'cancelled' };
      },
      onAddCard: () => {},
      onClose: () => {},
    }),
  );
  assert.ok(r.getByRole('button', { name: '放大原图：原图关系' }));
  assert.equal(r.queryByText('自测与复习'), null);
  assert.ok(r.container.querySelector('.sb-study-expanded'));
  assert.ok(
    r.container
      .querySelector('.sb-diagram-section')
      .compareDocumentPosition(r.container.querySelector('.sb-concept')) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  fireEvent.click(r.getByRole('button', { name: '＋ 重新整理' }));
  await waitFor(() => assert.equal(r.getByRole('button', { name: '生成AI总结' }).disabled, false));
  assert.equal(r.queryByRole('checkbox', { name: '生成少量核心复习题' }), null);
  fireEvent.click(r.getByRole('button', { name: '生成AI总结' }));
  await waitFor(() => assert.equal(generated.includeReview, true));
});

test('当前总结可直接删除、撤销及恢复，重开不显示已删除内容', async () => {
  let records = [
    {
      id: 's1',
      study: { ...studyFixture, title: '第一份总结' },
      text: '第一份',
      annotations: [],
      createdAt: new Date().toISOString(),
    },
    {
      id: 's2',
      study: { ...studyFixture, title: '第二份总结' },
      text: '第二份',
      annotations: [],
      createdAt: new Date().toISOString(),
    },
  ];
  const props = () => ({
    board: { id: 'b', summaries: records },
    api: async (method, r) => {
      if (method === 'models') return [];
      if (r?.action === 'setSummaryDeleted') {
        records = records.map((s) =>
          s.id === r.summaryId ? { ...s, deletedAt: r.deleted ? new Date().toISOString() : null } : s,
        );
        return {
          summary: records.find((s) => s.id === r.summaryId),
          meta: { summaryCount: records.filter((s) => !s.deletedAt).length },
        };
      }
      if (r?.action === 'summaryTask')
        return { id: 'j', status: 'done', summary: { ...records[1], deletedAt: null } };
      return null;
    },
    onError: (e) => {
      throw e;
    },
    onToast: () => {},
    onGenerate: () => {},
    onAddCard: () => {},
    onClose: () => {},
  });
  let r = render(React.createElement(StudyPanel, props()));
  await waitFor(() => assert.ok(r.getByRole('heading', { name: '第二份总结', level: 1 })));
  fireEvent.click(r.getByRole('button', { name: '删除这次总结' }));
  await waitFor(() => assert.ok(r.getByRole('heading', { name: '第一份总结', level: 1 })));
  assert.equal(r.getByRole('combobox', { name: '选择AI总结' }).options.length, 1);
  fireEvent.click(r.getByRole('button', { name: '撤销删除' }));
  await waitFor(() => assert.ok(r.getByRole('heading', { name: '第二份总结', level: 1 })));
  fireEvent.click(r.getByRole('button', { name: '删除这次总结' }));
  await waitFor(() => assert.ok(records[1].deletedAt));
  r.unmount();
  r = render(React.createElement(StudyPanel, props()));
  await waitFor(() => assert.ok(r.getByRole('heading', { name: '第一份总结', level: 1 })));
  assert.equal(r.queryByRole('heading', { name: '第二份总结', level: 1 }), null);
  fireEvent.click(r.getByRole('button', { name: '恢复总结' }));
  await waitFor(() => assert.ok(r.getByRole('heading', { name: '第二份总结', level: 1 })));
});
