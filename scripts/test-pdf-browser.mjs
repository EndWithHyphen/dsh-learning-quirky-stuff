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
import { executeStudyAction } from '../server/service-actions.js';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { assertPdfLayoutStable } from '../tests/browser/pdf-layout.mjs';
import { assertPdfKeyboardAndWindowDrag } from '../tests/browser/pdf-interaction.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'study-pdf-ui-')),
  store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init(),
  runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async text(options) {
        assert.ok(options.images.length);
        assert.match(options.prompt, /原文出处/);
        return {
          text: '**关键条件**：回答基于所选 PDF 原文。',
          model: { id: 'pdf-fixture', name: '验证模型' },
        };
      },
    },
  }).init();
const app = {
  store,
  learning,
  runtime,
  jobs: { latest: () => null, summaryChanged: async () => {}, forgetBoards: async () => {} },
  graphJobs: { get: () => null, forgetBoards: async () => {} },
  capture: { forgetBoards: async () => {} },
};
let releaseIndex;
const indexGate = new Promise((resolve) => {
  releaseIndex = resolve;
});
await build({
  entryPoints: ['tests/browser/entry.jsx'],
  outfile: join(temp, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  minify: true,
  plugins: [
    {
      name: 'test-canvas-api',
      setup(b) {
        b.onLoad({ filter: /src\/pdf\/frame-cache\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace(
              'this.entries = new Map();',
              'this.entries = new Map(); window.__pdfTestFrames = this; window.__pdfRasterCalls = 0;',
            )
            .replace(
              'return build(entry.controller.signal);',
              'window.__pdfRasterCalls++; return build(entry.controller.signal);',
            ),
          loader: 'js',
          resolveDir: join(root, 'src/pdf'),
        }));
        b.onLoad({ filter: /src\/client\.jsx$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'excali.current = value;',
            'excali.current = value; window.__pdfTestCanvas = value;',
          ),
          loader: 'jsx',
          resolveDir: join(root, 'src'),
        }));
      },
    },
    excalidrawChinese(),
    excalidrawCancellation(),
  ],
});
const html =
  '<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;font-family:system-ui}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fafafa;--dsw-alias-border-l1:#eceef0;--dsw-alias-border-l2:#dcdfe2;--dsw-alias-label-primary:#17181b;--dsw-alias-label-secondary:#60656c;--dsw-alias-label-tertiary:#868b93;--dsw-alias-brand-primary:#15161a;--dsw-alias-button-primary-fill:#15161a;--dsw-alias-label-inverse:#fff}</style><div id="root"></div><script src="/app.js"></script>';
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(await readFile(join(temp, 'app.js')));
      return;
    }
    if (req.url === '/qa-api') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { method, args } = JSON.parse(Buffer.concat(chunks)),
        request = args[0];
      if (request?.action === 'pdf.indexPage' && request.page === 1) await indexGate;
      const value =
        method === 'models' || request?.action === 'features.models'
          ? [{ id: 'pdf-fixture', provider: 'fixture', name: '验证模型', vision: true }]
          : method === 'captureInfo'
            ? { status: 'disabled', connections: [] }
            : await executeStudyAction(app, request);
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
  context = await browser.newContext({ viewport: { width: 1520, height: 1000 }, deviceScaleFactor: 2 }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.error('PAGEERROR: ' + e.stack);
});
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('dist/qa', { recursive: true });
async function selectQuote(quote) {
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  const target = page.locator('.textLayer span').filter({ hasText: quote }).first();
  await target.waitFor();
  const rect = await target.boundingBox();
  assert.ok(rect.width > 20 && rect.height > 5, JSON.stringify(rect));
  await target.evaluate((node, text) => {
    const selection = window.getSelection(),
      range = document.createRange(),
      child = node.firstChild,
      start = child.textContent.indexOf(text);
    range.setStart(child, start);
    range.setEnd(child, start + text.length);
    selection.removeAllRanges();
    selection.addRange(range);
    node.closest('.textLayer').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, quote);
  await page.getByText('已选 ' + quote.length + ' 字', { exact: true }).waitFor();
}
try {
  await page.goto(origin);
  await page.getByRole('button', { name: '导入 PDF', exact: true }).waitFor();
  await page
    .getByLabel('导入 PDF 新建笔记', { exact: true })
    .setInputFiles(resolve('tests/fixtures/pdf-learning-sample.pdf'));
  await page.locator('.sb-pdf-page .textLayer span').first().waitFor({ timeout: 30000 });
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  // A stalled index write must not prevent showing the PDF or its selectable text.
  releaseIndex();
  await page.getByRole('spinbutton', { name: 'PDF 页码' }).waitFor();
  const interaction = await assertPdfKeyboardAndWindowDrag(page);
  const note = (await store.library()).boards[0];
  assert.equal(note.pdfCount, 1);
  const document = (await runtime.execute({ action: 'pdf.list', noteId: note.id })).documents[0];
  assert.equal(document.pageCount, 4);
  await selectQuote('A claim needs evidence and explicit assumptions.');
  await page.getByRole('button', { name: '划线 / 批注', exact: true }).click();
  await page.getByRole('textbox', { name: 'PDF 批注内容' }).fill('需要继续核对这个假设。');
  await page.getByRole('button', { name: '保存批注', exact: true }).click();
  await page.getByRole('dialog', { name: 'PDF 划线批注' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '摘录文字', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.sb-pdf-selection-tools button')].some(
      (b) => b.textContent === '摘录文字' && !b.disabled,
    ),
  );
  await page.waitForFunction(() =>
    window.__pdfTestCanvas?.getSceneElements().some((e) => e.customData?.studyboard?.role === 'pdf-excerpt'),
  );
  const excerpt = await page.evaluate(() =>
    window.__pdfTestCanvas.getSceneElements().find((e) => e.customData?.studyboard?.role === 'pdf-excerpt'),
  );
  assert.equal(excerpt.customData.studyboard.pdfSource.page, 1);
  assert.match(excerpt.text, /A claim needs evidence/);
  const placement = await page.evaluate(() => {
    const api = window.__pdfTestCanvas,
      s = api.getAppState(),
      e = api.getSceneElements().find((e) => e.customData?.studyboard?.role === 'pdf-excerpt'),
      panel = document.querySelector('.selected-shape-actions .Island')?.getBoundingClientRect();
    return {
      left: (e.x + s.scrollX) * s.zoom.value + s.offsetLeft,
      panelRight: panel?.right,
      zoom: s.zoom.value,
      width: s.width,
    };
  });
  assert.ok(!placement.panelRight || placement.left > placement.panelRight, JSON.stringify(placement));
  await page.locator('.sb-pdf-selection-tools').getByRole('button', { name: '提问', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'PDF提问与备注' })
    .getByRole('textbox', { name: '提问或备注' })
    .fill('解释这个条件');
  await page
    .getByRole('dialog', { name: 'PDF提问与备注' })
    .getByRole('button', { name: '问 AI', exact: true })
    .click();
  await page
    .locator('.sb-pdf-reader .study-comment-message.assistant strong')
    .filter({ hasText: '关键条件' })
    .waitFor();
  await page.getByRole('button', { name: '关闭画布备注', exact: true }).click();
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('1.5');
  await selectQuote('Correlation alone does not establish causation.');
  await page.getByRole('button', { name: '划线 / 批注', exact: true }).click();
  await page.getByRole('button', { name: '保存批注', exact: true }).click();
  await page.getByRole('dialog', { name: 'PDF 划线批注' }).waitFor({ state: 'hidden' });
  const annotations = (await runtime.execute({ action: 'pdf.list', noteId: note.id })).notebook.annotations;
  assert.equal(annotations.filter((a) => a.kind === 'highlight').length, 2);
  assert.ok(annotations[1].rects[0][0] > 300);
  await page.getByRole('spinbutton', { name: 'PDF 页码' }).fill('2');
  await selectQuote('这是可选择的中文原文，用来验证摘录、划线和原页定位。');
  await page.getByRole('button', { name: '摘录文字', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.sb-pdf-selection-tools button')].some(
      (b) => b.textContent === '摘录文字' && !b.disabled,
    ),
  );
  await page.waitForFunction(() =>
    window.__pdfTestCanvas.getSceneElements().some((e) => e.customData?.studyboard?.pdfSource?.page === 2),
  );
  await page.getByRole('spinbutton', { name: 'PDF 页码' }).fill('3');
  await selectQuote('ROTATED PAGE: selection must remain anchored.');
  await page.getByRole('button', { name: '划线 / 批注', exact: true }).click();
  await page.getByRole('button', { name: '保存批注', exact: true }).click();
  await page.getByRole('dialog', { name: 'PDF 划线批注' }).waitFor({ state: 'hidden' });
  await page
    .locator('.study-tools')
    .getByRole('button', { name: '回到 PDF · 第 2 页 ↗', exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === '2');
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('fit');
  await page.getByRole('textbox', { name: '搜索 PDF' }).fill('Correlation');
  await page.locator('.sb-pdf-search').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('.sb-pdf-side-list').getByRole('button').filter({ hasText: '第 1 页' }).waitFor();
  await page.getByRole('button', { name: '关闭 PDF 列表' }).click();
  await page.getByRole('button', { name: '笔迹', exact: true }).click();
  const area = await page.getByRole('application', { name: 'PDF 手写批注' }).boundingBox();
  await page.mouse.move(area.x + 60, area.y + 150);
  await page.mouse.down();
  await page.mouse.move(area.x + 230, area.y + 170, { steps: 10 });
  await page.mouse.up();
  await page.locator('.sb-pdf-status').getByText('批注已保存', { exact: false }).waitFor();
  await page.getByRole('button', { name: '选文', exact: true }).click();
  await page.screenshot({ path: 'dist/qa/pdf-workspace.png' });
  await page.getByRole('spinbutton', { name: 'PDF 页码' }).fill('1');
  await page.locator('.sb-pdf-loading').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '框选', exact: true }).click();
  const sheet = await page.getByRole('application', { name: 'PDF 框选区域' }).boundingBox();
  await page.mouse.move(sheet.x + sheet.width * 0.07, sheet.y + sheet.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * 0.93, sheet.y + sheet.height * 0.82, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: '截取到画布', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.sb-pdf-selection-tools button')].some(
      (b) => b.textContent === '截取到画布' && !b.disabled,
    ),
  );
  await page.waitForFunction(() =>
    window.__pdfTestCanvas.getSceneElements().some((e) => e.customData?.studyboard?.role === 'pdf-figure'),
  );
  const figure = await page.evaluate(() => {
    const api = window.__pdfTestCanvas,
      element = api.getSceneElements().find((e) => e.customData?.studyboard?.role === 'pdf-figure');
    return { element, file: api.getFiles()[element.fileId] };
  });
  assert.equal(figure.element.customData.studyboard.pdfSource.page, 1);
  assert.match(figure.element.customData.studyboard.pdfSource.quote, /Equation \(1\)/);
  assert.match(figure.element.customData.studyboard.pdfSource.quote, /Figure 1/);
  assert.ok(figure.file.dataURL.length > 10000);
  await page.locator('.selected-shape-actions .Island').waitFor();
  const imagePlacement = await page.evaluate(() => {
    const api = window.__pdfTestCanvas,
      s = api.getAppState(),
      e = api.getSceneElements().find((e) => e.customData?.studyboard?.role === 'pdf-figure'),
      p = document.querySelector('.selected-shape-actions .Island').getBoundingClientRect();
    return { left: (e.x + s.scrollX) * s.zoom.value + s.offsetLeft, panelRight: p.right };
  });
  assert.ok(imagePlacement.left > imagePlacement.panelRight, JSON.stringify(imagePlacement));
  await writeFile('dist/qa/pdf-figure.jpg', Buffer.from(figure.file.dataURL.split(',')[1], 'base64'));
  await page.screenshot({ path: 'dist/qa/pdf-figure-workspace.png' });
  // Form drafts survive reopening the note even before pressing Save.
  await page.getByRole('button', { name: '划线 / 批注', exact: true }).click();
  await page.getByRole('textbox', { name: 'PDF 批注内容' }).fill('未提交的图表疑问');
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByText('pdf-learning-sample', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'PDF 批注内容' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'PDF 批注内容' }).inputValue(), '未提交的图表疑问');
  await page.locator('.sb-pdf-loading').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '保存批注', exact: true }).click();
  await page.getByRole('dialog', { name: 'PDF 划线批注' }).waitFor({ state: 'hidden' });
  let ocr = false;
  if ((await runtime.native.availability()).available) {
    await page.getByRole('spinbutton', { name: 'PDF 页码' }).fill('4');
    await page.locator('.sb-pdf-loading').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '识别当前页', exact: true }).click();
    await page.getByRole('textbox', { name: 'PDF 识别文字' }).waitFor({ timeout: 30000 });
    assert.match(await page.getByRole('textbox', { name: 'PDF 识别文字' }).inputValue(), /SCANNED PAGE/i);
    await page.getByRole('textbox', { name: 'PDF 识别文字' }).fill('核对后的扫描页原文');
    await page.getByRole('button', { name: '保存批注', exact: true }).click();
    await page.getByRole('dialog', { name: '核对 PDF 文字' }).waitFor({ state: 'hidden' });
    const values = (await runtime.execute({ action: 'pdf.list', noteId: note.id })).notebook.annotations;
    assert.ok(values.some((a) => a.page === 4 && a.origin === 'ocr' && a.quote === '核对后的扫描页原文'));
    assert.ok(values.some((a) => a.kind === 'ink'));
    ocr = true;
  }
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByText('pdf-learning-sample', { exact: true }).first().click();
  await page.locator('.sb-pdf-page .textLayer span').first().waitFor();
  const saved = await runtime.execute({ action: 'pdf.list', noteId: note.id });
  assert.ok(saved.notebook.annotations.some((a) => a.kind === 'ink'));
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page.getByRole('button', { name: '关联并打开', exact: true }).click();
  await page.locator('.sb-pdf-page .textLayer span').first().waitFor();
  assert.equal((await runtime.pdf.documents.list()).length, 1);
  assert.equal((await store.library()).boards.filter((b) => b.pdfCount === 1).length, 2);
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page
    .getByLabel('导入 PDF 新建笔记', { exact: true })
    .setInputFiles(resolve('tests/fixtures/pdf-learning-protected.pdf'));
  await page.getByRole('textbox', { name: 'PDF 密码' }).waitFor();
  await page.getByRole('textbox', { name: 'PDF 密码' }).fill('wrong-password');
  await page.locator('.sb-pdf-password').getByRole('button', { name: '打开', exact: true }).click();
  await page.getByText('密码不正确，请重试', { exact: false }).waitFor();
  await page.getByRole('textbox', { name: 'PDF 密码' }).fill('fixture-password');
  await page.locator('.sb-pdf-password').getByRole('button', { name: '打开', exact: true }).click();
  await page.locator('.textLayer span').filter({ hasText: 'Protected PDF fixture' }).waitFor();
  const idleLayout = await assertPdfLayoutStable(page);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      pdf: true,
      idleLayout,
      ...interaction,
      import: true,
      sharedOriginal: true,
      selection: true,
      columns: true,
      unicode: true,
      rotation: true,
      annotations: true,
      sourceReturn: true,
      questions: true,
      search: true,
      persisted: true,
      figureAndFormula: true,
      password: true,
      editorDraft: true,
      ocr,
    }),
  );
} catch (e) {
  await page.screenshot({ path: 'dist/qa/pdf-failure.png' });
  await writeFile('dist/qa/pdf-failure.txt', await page.locator('body').innerText());
  throw e;
} finally {
  releaseIndex();
  await browser.close();
  await runtime.dispose();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
