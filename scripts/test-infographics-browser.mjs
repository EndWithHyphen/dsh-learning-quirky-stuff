import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { encode, decode } from 'fast-png';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { parseStudy } from '../study-schema.js';
import { studyFixture } from '../tests/fixture.mjs';
import { infographicFixture, infographicPassage } from '../tests/infographic-fixture.mjs';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'studyboard-infographics-ui-'));
const store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init();
const runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
  gateway: {
    async json() {
      return {
        value: { decision: 'compose', reason: '区分不同条件', figures: [infographicFixture('A-c1')] },
        model: { provider: 'fixture', id: 'fixture' },
      };
    },
  },
}).init();
const note = await store.create({ title: '信息图界面验证' });
const pixels = new Uint8Array(8 * 4 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = (i / 4) % 8 < 4 ? 220 : 30;
  pixels[i + 1] = 120;
  pixels[i + 2] = 180;
  pixels[i + 3] = 255;
}
const imageData =
  'data:image/png;base64,' +
  Buffer.from(encode({ width: 8, height: 4, channels: 4, data: pixels })).toString('base64');
const visualFixture = infographicFixture();
visualFixture.nodes.push({
  ...visualFixture.nodes[0],
  id: 'source-photo',
  kind: 'image',
  text: '',
  x: 1360,
  y: 265,
  width: 112,
  height: 112,
  imageSourceId: 'S01',
  crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
  sourceIds: ['S01'],
});
const summary = await store.addSummary(note.id, {
  study: parseStudy({
    ...studyFixture,
    title: '公开表达与共同判断',
    concepts: [{ ...studyFixture.concepts[0], title: '表达机会与判断质量', explanation: infographicPassage }],
    diagrams: [],
    infographics: [visualFixture],
  }),
  text: infographicPassage,
  assets: {
    S01: {
      dataURL: imageData,
      width: 400,
      height: 400,
      crop: { x: 2, y: 0, width: 4, height: 4, naturalWidth: 8, naturalHeight: 4 },
      scale: [-1, 1],
      angle: 0,
    },
  },
  visualSources: [
    { id: 'T01', kind: 'text', title: '画布文字', text: infographicPassage },
    { id: 'S01', kind: 'image', title: '测试原图', text: '用于裁剪与翻转验证' },
  ],
  provider: 'fixture',
  model: 'fixture',
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
  logLevel: 'warning',
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
          ? [{ provider: 'fixture', id: 'fixture', name: '隔离验证模型', vision: true }]
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }),
  page = await context.newPage(),
  errors = [],
  qa = resolve('dist/qa');
page.setDefaultTimeout(12000);
page.on('pageerror', (error) => errors.push(error.message));
await mkdir(qa, { recursive: true });
const openSummary = async () => {
  await page.getByText('信息图界面验证', { exact: true }).first().click();
  await page
    .locator('.sb-board-header')
    .getByRole('button', { name: /^AI总结/ })
    .click();
  await page.locator('.sb-info-preview img').waitFor();
};
const preview = () =>
  page.locator('.sb-info-preview img').evaluate(async (img) => await (await fetch(img.src)).text());
const waitPreview = (text, present = true) =>
  page.waitForFunction(
    async ({ text, present }) => {
      try {
        const image = document.querySelector('.sb-info-preview img');
        if (!image) return false;
        const svg = await (await fetch(image.src)).text();
        return svg.includes(text) === present;
      } catch {
        return false;
      }
    },
    { text, present },
  );
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await openSummary();
  await page.locator('.sb-info-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(qa, 'infographic-summary.png'), fullPage: true });
  await page.locator('.sb-info-card').getByRole('button', { name: '来源', exact: true }).click();
  await page.locator('.sb-info-evidence').waitFor();
  assert.match(await page.locator('.sb-info-evidence').textContent(), /公开表达机会扩大/);
  await page.getByRole('button', { name: '关闭信息图来源', exact: true }).click();
  let dropped = false;
  await page.route('**/qa-api', async (route) => {
    const request = route.request().postDataJSON().args?.[0];
    if (
      !dropped &&
      request?.action === 'infographics.saveCanvas' &&
      request.scene.elements.some((e) => e.text === '我的图解备注')
    ) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.locator('.sb-info-dialog').getByRole('button', { name: '文字', exact: true }).click();
  const box = await page.locator('.sb-info-engine').boundingBox();
  await page.mouse.click(box.x + box.width - 130, box.y + box.height - 75);
  await page.locator('.sb-info-engine textarea').fill('我的图解备注');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.sb-info-dialog [role=status]')?.textContent === '已保存',
  );
  assert.equal(dropped, true);
  await page.screenshot({ path: join(qa, 'infographic-editor.png') });
  const download = page.waitForEvent('download');
  await page.getByLabel('导出信息图').selectOption('excalidraw');
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert(exported.elements.some((e) => e.text === '我的图解备注'));
  const centered = exported.elements.find((e) => e.text === '表达机会扩大');
  assert(centered.x >= 100 && centered.x + centered.width <= 431, '居中文字必须留在规划区域内');
  const picture = exported.elements.find((e) => e.type === 'image');
  assert.equal(picture.crop.naturalWidth, 4);
  assert.equal(picture.crop.x, 1);
  assert.equal(picture.crop.width, 2);
  assert.equal(decode(Buffer.from(exported.files[picture.fileId].dataURL.split(',')[1], 'base64')).width, 4);
  const pngDownload = page.waitForEvent('download');
  await page.getByLabel('导出信息图').selectOption('png');
  assert((await readFile(await (await pngDownload).path())).length > 20000);
  await page.getByRole('button', { name: '保存并关闭', exact: true }).click();
  await page.locator('.sb-info-dialog').waitFor({ state: 'detached' });
  await waitPreview('我的图解备注');
  await page.reload();
  await openSummary();
  await waitPreview('我的图解备注');
  await page.locator('.sb-info-card').getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('button', { name: '按内容生成', exact: true }).click();
  await page.getByLabel('信息图版本').waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="信息图版本"]')?.options.length === 2);
  await page.waitForFunction(() => document.querySelector('.sb-info-preview img'));
  await waitPreview('我的图解备注', false);
  await page.getByLabel('信息图版本').selectOption('ig1');
  await waitPreview('我的图解备注');
  await page.locator('.sb-info-card').getByRole('button', { name: '隐藏', exact: true }).click();
  await page.locator('.sb-info-card').waitFor({ state: 'detached' });
  await page.locator('.sb-info-hidden summary').click();
  await page.getByRole('button', { name: '恢复显示', exact: true }).click();
  await page.locator('.sb-info-preview img').waitFor();
  await page.getByLabel('信息图版本').selectOption('ig1');
  await page.locator('.sb-info-preview img').waitFor();
  await page.locator('.sb-info-card').getByRole('button', { name: '放回白板', exact: true }).click();
  await page.locator('.sb-study-panel').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.sb-save-state')?.textContent.includes('已保存'));
  const copied = await store.read(note.id);
  assert(copied.scene.elements.some((e) => e.text === '我的图解备注'));
  assert(copied.scene.elements.every((e) => e.customData?.studyboard?.summaryId === summary.id));
  assert.equal(new Set(copied.scene.elements.map((e) => e.id)).size, copied.scene.elements.length);
  assert.deepEqual(errors, []);
  await writeFile(
    join(qa, 'infographics-browser-result.json'),
    JSON.stringify(
      {
        ok: true,
        tests: [
          '正文图解',
          '来源对照',
          '原生编辑',
          '响应丢失后幂等重试',
          '导出编辑内容',
          '刷新恢复',
          '新旧版本隔离',
          '隐藏恢复',
          '放回白板保留编辑和来源',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Infographic browser checks passed.');
} catch (error) {
  await page.screenshot({ path: join(qa, 'infographic-failure.png'), fullPage: true });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
  server.close();
  await runtime.dispose();
}
