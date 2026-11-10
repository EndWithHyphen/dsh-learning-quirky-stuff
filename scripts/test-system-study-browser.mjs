import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { STUDY_PLAN_SCHEMA } from '../server/system-study/schema.js';
import { WEEKLY_SCHEMA } from '../server/modules/weekly.js';
import { passage, studyPlanFixture, systemStudyFixture } from '../tests/system-study-fixture.mjs';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'studyboard-system-ui-'));
const store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init();
const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
  gateway: {
    async json(options) {
      let value;
      if (options.schema === STUDY_PLAN_SCHEMA) value = structuredClone(studyPlanFixture);
      else if (options.schema === WEEKLY_SCHEMA) {
        const start = options.prompt.lastIndexOf('资料：') + 3;
        const records = JSON.parse(options.prompt.slice(start, options.prompt.indexOf('\n输出：', start)));
        const claim = {
          text: '本周记录围绕表达机会和公共判断的条件展开。',
          evidence: [{ sourceId: records[0].id, quote: records[0].text }],
        };
        value = {
          title: '本周的公共判断学习回顾',
          overview: claim,
          knowledgeSummary: {
            mainline: claim,
            points: [{ title: '参与机会与判断质量', explanation: claim }],
          },
          reviewQuestions: [
            {
              kind: 'explain',
              prompt: '表达机会为什么不足以保证判断质量？',
              context: '',
              tasks: ['说明一个中间条件'],
              answer: '还需要分发、证据检验和回应的条件。',
              hint: '从证据检验入手。',
              checkpoints: ['区分参与和结果'],
              evidence: claim.evidence,
            },
            {
              kind: 'apply',
              prompt: '怎样检查一种分发机制是否改善判断？',
              context: '',
              tasks: [],
              answer: '检查相应的证据检验与结果。',
              hint: '',
              checkpoints: [],
              evidence: claim.evidence,
            },
          ],
          themes: [{ title: '参与与判断的联系', progress: claim }],
          changes: [],
          connections: [],
          nextWeek: [{ focus: '用具体材料检验成立条件', reason: claim }],
        };
      } else {
        const start = options.prompt.lastIndexOf('资料：') + 3;
        const records = JSON.parse(options.prompt.slice(start, options.prompt.indexOf('\n输出：', start)));
        value = systemStudyFixture(records);
        const era = {
          id: 'early',
          label: '1968 · 协作视角',
          cutoffYear: 1968,
          problem: '怎样让分散的研究者共同讨论？',
          availableKnowledge: '交互式计算与共同工作空间的尝试。',
          explanation: '把各自的假设外化，比较解释的分歧。',
          unknown: '大规模商业平台的社会效果。',
          laterRevision: '需要进一步检验分发规则对可见性的影响。',
          evidence: [{ sourceId: records[0].id, quote: records[0].text }],
          laterEvidence: [],
        };
        value.history = {
          applicable: true,
          reason: '验证历史研究的画布与资料呈现。',
          title: '公共讨论的历史解释',
          format: 'comparison',
          periods: [
            era,
            {
              ...era,
              id: 'late',
              label: '2000 · 制度视角',
              cutoffYear: 2000,
              problem: '谁在制定网络参与规则？',
              explanation: '架构的选择会影响进入、发现与退出。',
            },
          ],
        };
      }
      return { value, model: { provider: 'fixture', id: 'fixture', name: '隔离验证模型' } };
    },
  },
}).init();
const note = await store.create({ title: '系统学习界面验证' });
await store.save({
  id: note.id,
  baseRevision: 0,
  scene: {
    elements: [
      {
        id: 'main',
        type: 'text',
        x: 0,
        y: 0,
        width: 660,
        height: 70,
        text: passage,
        originalText: passage,
        fontSize: 20,
        fontFamily: 2,
        lineHeight: 1.4,
        angle: 0,
        strokeColor: '#111111',
        version: 1,
      },
    ],
    files: {},
    appState: {},
  },
});
await build({
  absWorkingDir: root,
  entryPoints: ['tests/browser/entry.jsx'],
  outfile: join(temp, 'client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  plugins: [excalidrawChinese(), excalidrawCancellation()],
  minify: true,
});
const html =
  '<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;font-family:system-ui}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fafafa;--dsw-alias-border-l1:#eceef0;--dsw-alias-border-l2:#dcdfe2;--dsw-alias-label-primary:#17181b;--dsw-alias-label-secondary:#60656c;--dsw-alias-label-tertiary:#868b93;--dsw-alias-brand-primary:#15161a;--dsw-alias-button-primary-fill:#15161a;--dsw-alias-label-inverse:#fff}</style><div id="root"></div><script src="/client.js"></script>';
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (req.url === '/qa-api') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { method, args } = JSON.parse(Buffer.concat(chunks));
      const request = args[0];
      const value =
        method === 'models'
          ? [{ provider: 'fixture', id: 'fixture', name: '隔离验证模型', vision: false }]
          : method === 'captureInfo'
            ? { status: 'disabled', connections: [] }
            : request.action === 'summaryTask'
              ? null
              : runtime.has(request.action)
                ? await runtime.execute(request)
                : await learning.dispatch(request);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, value }));
      return;
    }
    if (req.url === '/client.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(await readFile(join(temp, 'client.js')));
      return;
    }
    if (req.url.startsWith('/assets/fonts/')) {
      res.end(
        await readFile(
          join(root, 'node_modules/@excalidraw/excalidraw/dist/prod', decodeURIComponent(req.url.slice(8))),
        ),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { message: error.message } }));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const qa = resolve('dist/qa');
await mkdir(qa, { recursive: true });
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.locator('.sb-nav-row').filter({ hasText: '专题工作台' }).click();
  await page.locator('.sb-topic-empty').waitFor();
  assert.equal(await page.locator('.sb-topics-page .sb-module-split').count(), 0);
  assert.equal(await page.getByRole('button', { name: '新建专题', exact: true }).count(), 1);
  await page.screenshot({ path: join(qa, 'topics-empty.png'), fullPage: true });
  await page.getByRole('button', { name: '新建专题', exact: true }).click();
  await page.getByLabel('专题名称', { exact: true }).fill('专题排版验证');
  await page.getByRole('checkbox', { name: '系统学习界面验证', exact: true }).check();
  await page.getByRole('button', { name: '保存专题', exact: true }).click();
  await page.locator('.sb-module-main').getByRole('heading', { name: '专题排版验证', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除专题', exact: true }).click();
  await page.locator('.sb-topic-empty').waitFor();
  await page.locator('.sb-topics-archive summary').click();
  await page.locator('.sb-topics-archive').getByRole('button', { name: '恢复', exact: true }).click();
  await page.locator('.sb-module-main').getByRole('heading', { name: '专题排版验证', exact: true }).waitFor();
  await page.locator('.sb-nav-row').filter({ hasText: '全部笔记' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText('系统学习界面验证', { exact: true }).first().click();
  await page.getByRole('button', { name: 'AI总结', exact: true }).click();
  await page.getByRole('button', { name: '系统学习', exact: true }).click();
  await page.getByLabel('系统学习主题', { exact: true }).fill('开放表达与公共判断');
  await page.getByRole('button', { name: '生成系统学习白板', exact: true }).click();
  await page.locator('.sb-system-canvas').waitFor({ timeout: 30000 });
  await page.locator('.sb-system-canvas-actions').getByText('已保存', { exact: true }).waitFor();
  let records = await runtime.repositories['study-canvases'].list();
  assert.equal(records.length, 1);
  const id = records[0].id;
  assert.ok(records[0].scene.elements.some((e) => e.type === 'arrow' && e.startBinding && e.endBinding));
  assert.ok(records[0].scene.elements.some((e) => e.type === 'text' && e.text.includes('当时的解释')));
  await page.screenshot({ path: join(qa, 'system-study.png'), fullPage: true });
  await page.getByRole('button', { name: '公共讨论的历史解释', exact: true }).click();
  await page.getByRole('button', { name: '专注画布', exact: true }).click();
  await page.screenshot({ path: join(qa, 'system-study-history.png'), fullPage: true });
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await page.getByRole('button', { name: '参与如何转化为判断', exact: true }).click();
  await page.getByRole('button', { name: '专注画布', exact: true }).click();
  let droppedSave = false;
  await page.route('**/qa-api', async (route) => {
    const message = route.request().postDataJSON(),
      request = message.args?.[0];
    if (
      !droppedSave &&
      request?.action === 'systemStudy.saveCanvas' &&
      request.scene.elements.some((e) => e.text === '我补充的论点')
    ) {
      droppedSave = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const textTool = page.locator('.sb-system-canvas').getByRole('button', { name: '文字', exact: true });
  await textTool.click();
  const box = await page.locator('.sb-system-engine').boundingBox();
  await page.mouse.click(box.x + box.width - 80, box.y + box.height - 80);
  const input = page.locator('.sb-system-engine textarea');
  await input.waitFor();
  await input.fill('我补充的论点');
  await page.keyboard.press('Escape');
  await page.locator('.sb-system-canvas').getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.sb-system-canvas-actions').getByText('草稿保存在本机', { exact: true }).waitFor();
  await page.locator('.sb-system-canvas').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.sb-system-canvas-actions [role=status]')?.textContent === '已保存',
  );
  records = await runtime.repositories['study-canvases'].list();
  assert.equal(droppedSave, true);
  assert.ok(records[0].scene.elements.some((e) => e.text === '我补充的论点'));
  const oldText = records[0].scene.elements.find(
    (e) => e.type === 'text' && e.containerId && e.text.startsWith('表达机会'),
  );
  const state = records[0].scene.appState,
    engine = await page.locator('.sb-system-engine').boundingBox();
  await page.locator('.sb-system-canvas').getByRole('button', { name: '选择', exact: true }).click();
  await page.mouse.dblclick(
    engine.x + (oldText.x + state.scrollX + 36) * state.zoom.value,
    engine.y + (oldText.y + state.scrollY + 10) * state.zoom.value,
  );
  const existingEditor = page.locator('.sb-system-engine textarea');
  await existingEditor.waitFor();
  await existingEditor.fill('表达机会\n\n我修改了生成的论点，准备重新核对证据。');
  await page.keyboard.press('Escape');
  await page.locator('.sb-system-canvas').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.sb-system-canvas-actions [role=status]')?.textContent === '已保存',
  );
  assert.ok(
    (await runtime.repositories['study-canvases'].get(id)).scene.elements.some(
      (e) => e.id === oldText.id && e.text.includes('我修改了生成的论点'),
    ),
  );
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载画布', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  assert.ok(exported.elements.some((e) => e.text === '我补充的论点'));
  const pdfDownload = page.waitForEvent('download');
  await page.locator('.sb-system-canvas').getByRole('button', { name: 'PDF', exact: true }).click();
  const pdf = await readFile(await (await pdfDownload).path());
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await page.getByRole('button', { name: '加入复习', exact: true }).click();
  await page.getByText('已加入复习', { exact: true }).waitFor();
  assert.equal((await learning.dashboard()).total, 1);
  await page.getByRole('button', { name: '删除这次结果', exact: true }).click();
  await page.getByText('已删除的系统学习结果', { exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.locator('.sb-system-canvas').waitFor();
  assert.equal(
    (await runtime.execute({ action: 'systemStudy.get', id })).canvas.scene.elements.some(
      (e) => e.text === '我补充的论点',
    ),
    true,
  );
  await page.reload();
  await page.locator('.sb-nav-row').filter({ hasText: '学习周报' }).click();
  await page.locator('.sb-weekly-stats').waitFor();
  const periodBoxes = await page
    .locator('.sb-weekly-period button, .sb-weekly-period input, .sb-weekly-period > label')
    .evaluateAll((elements) =>
      elements.map((e) => ({
        bottom: e.getBoundingClientRect().bottom,
        height: e.getBoundingClientRect().height,
      })),
    );
  assert.ok(
    periodBoxes.every(
      (rect) => Math.abs(rect.bottom - periodBoxes[0].bottom) < 1 && Math.abs(rect.height - 40) < 1,
    ),
    JSON.stringify(periodBoxes),
  );
  await page.locator('.sb-weekly-period').screenshot({ path: join(qa, 'weekly-toolbar.png') });
  assert.equal(
    await page
      .locator('.sb-weekly-stats>div')
      .filter({ hasText: '复习次数' })
      .locator('strong')
      .textContent(),
    '0',
  );
  await page.getByRole('button', { name: '生成本周总结', exact: true }).click();
  await page.locator('.sb-weekly-report h2').getByText('本周的公共判断学习回顾', { exact: true }).waitFor();
  await page.screenshot({ path: join(qa, 'learning-weekly.png'), fullPage: true });
  await page.getByRole('heading', { name: '本周知识总结', exact: true }).waitFor();
  await page.getByRole('button', { name: '复习本周', exact: true }).click();
  const weeklyReview = page.locator('.sb-weekly-review');
  await weeklyReview.getByLabel('我的回答', { exact: true }).first().waitFor();
  assert.equal(
    await weeklyReview.getByText('还需要分发、证据检验和回应的条件。', { exact: true }).isVisible(),
    false,
  );
  await weeklyReview
    .getByLabel('我的回答', { exact: true })
    .first()
    .fill('需要通过证据检验，不能只数发言数量。');
  await weeklyReview.getByRole('button', { name: '下一题', exact: true }).click();
  await weeklyReview.getByLabel('我的回答', { exact: true }).nth(1).fill('检查具体条件与判断结果。');
  await weeklyReview.getByRole('button', { name: '上一题', exact: true }).click();
  assert.equal(
    await weeklyReview.getByLabel('我的回答', { exact: true }).first().inputValue(),
    '需要通过证据检验，不能只数发言数量。',
  );
  await weeklyReview.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await weeklyReview.getByRole('button', { name: '记得', exact: true }).click();
  await weeklyReview.getByText(/已记录本次复习，下次安排/).waitFor();
  assert.equal(learning.data.reviews.length, 1);
  assert.equal(
    Object.values(learning.data.cards).filter((card) => card.origin?.feature === 'weekly').length,
    1,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.sb-weekly-stats>div')]
        .find((e) => e.textContent.includes('复习次数'))
        ?.querySelector('strong').textContent === '1',
  );
  await page.screenshot({ path: join(qa, 'weekly-review.png'), fullPage: true });
  await weeklyReview.getByRole('button', { name: '下一题', exact: true }).click();
  await weeklyReview.getByRole('button', { name: '不再出现', exact: true }).click();
  await weeklyReview.getByText('这道题已设为不再出现。', { exact: true }).waitFor();
  assert.match(await weeklyReview.locator('.sb-weekly-review-nav').innerText(), /第 1 \/ 1 题/);
  await page.getByRole('button', { name: '本周总结', exact: true }).click();
  const weeklyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载周报', exact: true }).click();
  assert.match(await readFile(await (await weeklyDownload).path(), 'utf8'), /复习：0 次/);
  await page.getByRole('button', { name: '删除这份周报', exact: true }).click();
  await page.getByText('已删除的周报', { exact: true }).click();
  await page.locator('.sb-weekly-trash').getByRole('button', { name: '恢复', exact: true }).click();
  await page.locator('.sb-weekly-report h2').waitFor();
  const latestWeekly = (await runtime.repositories.reports.list()).find((r) => r.feature === 'weekly');
  const legacy = structuredClone(latestWeekly);
  legacy.id = 'legacy-weekly';
  legacy.createdAt = new Date().toISOString();
  legacy.value.title = '旧版周报回顾';
  delete legacy.value.knowledgeSummary;
  delete legacy.value.reviewQuestions;
  await runtime.repositories.reports.put(legacy.id, legacy);
  await page.reload();
  await page.locator('.sb-nav-row').filter({ hasText: '学习周报' }).click();
  await page.getByRole('heading', { name: '旧版周报回顾', exact: true }).waitFor();
  await page.getByRole('button', { name: '复习本周', exact: true }).click();
  await page.locator('.sb-weekly-review .sb-question-card').first().waitFor();
  assert.equal((await runtime.repositories.reports.get(legacy.id)).value.reviewQuestions, undefined);
  await page.getByLabel('周报日期', { exact: true }).fill('2010-01-04');
  await page
    .getByText('这一周还没有可用于回顾的正文、总结或复习记录。记录学习内容后再生成，也可以切换周次。', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByRole('button', { name: '生成本周总结', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '复习本周', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: system learning, history research, editing, save retry, PDF/export, review, delete/restore, weekly stats/generation/export, empty weeks.',
  );
} catch (error) {
  await page.screenshot({ path: join(qa, 'system-study-failure.png'), fullPage: true });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
  await runtime.dispose();
  await new Promise((r) => server.close(r));
}
