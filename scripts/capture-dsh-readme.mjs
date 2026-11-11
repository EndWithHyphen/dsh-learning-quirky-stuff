import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { parseStudy } from '../study-schema.js';
import { graphInput, parseGraphReport } from '../graph-ai.js';
import { studyFixture } from '../tests/fixture.mjs';
import { infographicFixture, infographicPassage } from '../tests/infographic-fixture.mjs';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';

// Real plugin UI with an isolated synthetic library. No personal notes or model calls.
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'studyboard-dsh-readme-')),
  output = resolve('docs/images'),
  store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init(),
  runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async json() {
        throw new Error('Documentation uses prepared examples');
      },
      async text() {
        throw new Error('Documentation uses prepared examples');
      },
    },
  }).init();
await mkdir(output, { recursive: true });
const concepts = [
  ['表达机会', '表达机会扩大，需要分发规则让论点进入可讨论的视野。'],
  ['分发规则', '分发规则决定哪些论点被看见；可见的论点仍需证据检验。'],
  ['证据检验', '证据检验让论点接受核对，是形成共同判断的条件之一。'],
  ['相互回应', '相互回应使分歧得到讨论，并促使各方修正论点，是形成共同判断的条件之一。'],
  ['共同判断', '共同判断取决于证据检验和相互回应；表达数量增加不自动保证判断质量提高。'],
].map(([title, explanation], i) => ({
  id: 'c' + (i + 1),
  title,
  explanation,
  canonicalKey: '公共讨论/' + title,
  prerequisites: [],
  example: '',
}));
const folder = await store.editFolder({ name: '阅读与研究' }),
  note = await store.create({ title: '开放表达与共同判断', folderId: folder.id });
await store.metadata({ id: note.id, tags: ['论证', '材料精读'] });
await store.save({
  id: note.id,
  baseRevision: 0,
  scene: {
    appState: {},
    files: {},
    elements: [
      {
        id: 'source-text',
        type: 'text',
        x: 60,
        y: 70,
        width: 700,
        height: 150,
        fontSize: 20,
        fontFamily: 2,
        lineHeight: 1.4,
        angle: 0,
        strokeColor: '#24382c',
        version: 1,
        text: infographicPassage,
        originalText: infographicPassage,
      },
    ],
  },
});
const summary = await store.addSummary(note.id, {
  provider: 'demo',
  model: '演示内容',
  text: infographicPassage,
  study: parseStudy({
    ...studyFixture,
    title: '从表达机会到共同判断',
    overview: infographicPassage,
    takeaways: ['先区分“更多人能够表达”与“判断质量得到改善”。', '沿着分发、检验与回应，找出中间机制。'],
    concepts,
    relations: [],
    diagrams: [],
    infographics: [{ ...infographicFixture(), placement: 'overview' }],
    questions: [
      {
        id: 'q1',
        kind: 'explain',
        prompt: '为什么更多表达机会不一定带来更好的共同判断？',
        answer: '表达机会只解决进入问题。论点能否被看见取决于分发规则，能否被修正取决于证据检验与相互回应。',
        hint: '把参与入口和中间机制分开。',
        conceptIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
        checkpoints: ['区分参与机会与判断结果', '说明至少一个中间机制'],
      },
      {
        id: 'q2',
        kind: 'apply',
        prompt: '读到一篇论证时，如何检查它的成立条件？',
        answer: '先找出核心主张，再核对支持证据，并检查作者忽略的条件和可能的竞争解释。',
        hint: '从主张、证据和边界入手。',
        conceptIds: ['c3'],
      },
      {
        id: 'q3',
        kind: 'compare',
        prompt: '“被看见”和“被证据支持”有什么区别？',
        answer: '前者描述论点的可见性，后者描述论点得到支持的程度。可见性提高本身不能代替证据。',
        hint: '区分传播条件与认识依据。',
        conceptIds: ['c2', 'c3'],
      },
    ],
    extensions: [{ topic: '分发与认识', question: '一种分发规则怎样改变人们接触到的证据？' }],
  }),
  assets: {},
  visualSources: [{ id: 'T01', kind: 'text', title: '演示材料', text: infographicPassage }],
});
await learning.enroll({ id: note.id, summaryId: summary.id });
const input = await graphInput(learning),
  sources = concepts.map((c) => input.sources.find((s) => s.conceptId === c.id)),
  evidence = (i) => [{ sourceId: sources[i].id, quote: sources[i].text }],
  triples = [
    [0, '依赖', 1, 0],
    [1, '提供待检验论点', 2, 1],
    [2, '支撑', 4, 2],
    [3, '支撑', 4, 3],
  ].map(([a, p, b, s], i) => ({
    id: 'r' + i,
    subject: 'e' + a,
    predicate: p,
    object: 'e' + b,
    explanation: concepts[s].explanation,
    inferred: false,
    evidence: evidence(s),
  }));
const report = parseGraphReport(
  {
    overview:
      '材料把共同判断理解为一个有条件的过程：表达提供入口，分发影响可见性，检验与回应推动论点修正。这些关系来自演示材料中的观点。',
    entities: concepts.map((c, i) => ({
      id: 'e' + i,
      name: c.title,
      type: 'concept',
      aliases: [],
      description: c.explanation,
      sourceIds: [sources[i].id],
    })),
    triples,
    maps: [
      {
        id: 'map',
        title: '从表达走向判断',
        question: '表达机会如何转化为共同判断？',
        takeaway: { text: '分发、检验与回应共同构成从参与到判断的条件。', evidence: evidence(4) },
        topicIds: input.topics.map((t) => t.id),
        coreEntityIds: concepts.map((_, i) => 'e' + i),
        coreTripleIds: triples.map((t) => t.id),
        groups: [
          { title: '参与与可见性', entityIds: ['e0', 'e1'] },
          { title: '论点如何修正', entityIds: ['e2', 'e3'] },
          { title: '形成判断', entityIds: ['e4'] },
        ],
        branches: [],
      },
    ],
  },
  input,
);
await learning.saveGraphReport({
  ...report,
  id: 'documentation-graph',
  createdAt: new Date().toISOString(),
  provider: 'demo',
  model: '演示内容',
  fingerprint: input.fingerprint,
  coverage: input.coverage,
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
const models = [{ provider: 'demo', id: 'demo', name: '演示内容', vision: true }];
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (req.url === '/client.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(await readFile(join(temp, 'client.js')));
      return;
    }
    if (req.url === '/qa-api') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { method, args } = JSON.parse(Buffer.concat(chunks)),
        r = args[0];
      const value =
        method === 'models' || r?.action === 'features.models'
          ? models
          : method === 'captureInfo'
            ? { status: 'disabled', connections: [] }
            : r.action === 'summaryTask'
              ? null
              : r.action === 'graph'
                ? { ...(await learning.graph()), aiJob: null }
                : runtime.has(r.action)
                  ? await runtime.execute(r)
                  : await learning.dispatch(r);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, value }));
      return;
    }
    if (req.url.startsWith('/assets/fonts/') && !decodeURIComponent(req.url).includes('..')) {
      res.end(
        await readFile(
          join(root, 'node_modules/@excalidraw/excalidraw/dist/prod', decodeURIComponent(req.url.slice(8))),
        ),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { message: e.message } }));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const settle = () =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.getByText(note.title, { exact: true }).first().click();
  await page.getByRole('button', { name: /^AI总结/ }).click();
  await page.locator('.sb-info-card').first().waitFor();
  const figureBox = await page.locator('.sb-info-card').first().boundingBox();
  await page.setViewportSize({ width: 1440, height: Math.ceil(figureBox.y + figureBox.height + 24) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.sb-study-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle();
  await page.screenshot({ path: join(output, 'dsh-summary.png') });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: /^AI总结/ }).click();
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByRole('button', { name: '知识图谱', exact: true }).click();
  await page.locator('svg.sb-graph-layered').waitFor();
  await settle();
  await page.screenshot({ path: join(output, 'dsh-graph.png') });
  await page.getByRole('button', { name: /^今日复习/ }).click();
  await page
    .getByRole('textbox', { name: '我的回答', exact: true })
    .fill('表达提供参与的入口；论点能否被看见、检验和回应，才影响判断质量。');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await settle();
  await page.screenshot({ path: join(output, 'dsh-review.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      screenshots: ['dsh-summary.png', 'dsh-graph.png', 'dsh-review.png'],
      syntheticData: true,
      modelCalls: 0,
    }),
  );
} catch (e) {
  await mkdir('dist/qa', { recursive: true });
  await page.screenshot({ path: 'dist/qa/dsh-readme-failure.png' });
  throw e;
} finally {
  await browser.close();
  await runtime.dispose();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
