import { chromium } from 'playwright';
import { build } from 'esbuild';
import { cp, readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { decode } from 'fast-png';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { CaptureServer } from '../capture-server.js';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';

// Documentation only: real extension UI, synthetic material, disposable profile and data directory.
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'studyboard-readme-')),
  extension = join(temp, 'extension');
await cp('chrome-extension', extension, {
  recursive: true,
  filter: (file) => !/(?:connection\.json(?:\.bak)?|\.log)$/.test(file),
});
const store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init(),
  runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning).init();
const bridge = new CaptureServer(store, { port: 0 });
bridge.moduleAction = (request) => runtime.execute(request);
await bridge.start();
for (const file of ['options.html', 'options.js'])
  await writeFile(
    join(extension, file),
    (await readFile(join(extension, file), 'utf8')).replaceAll('43127', String(bridge.port)),
  );
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
// Equivalent to a user granting activeTab for the one example page; not shipped in the extension.
manifest.host_permissions = ['http://127.0.0.1/*', 'https://example.org/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
await build({
  absWorkingDir: root,
  entryPoints: ['src/chrome-canvas.jsx'],
  outfile: join(extension, 'canvas.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  minify: true,
  plugins: [
    {
      name: 'documentation-canvas-access',
      setup(build) {
        build.onLoad({ filter: /chrome-canvas\.jsx$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'api = value;',
            'api = value; window.__docsCanvas = value;',
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

const articleUrl = 'https://example.org/reading/claims-and-evidence';
const articleHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>读懂一篇材料：结论、证据与边界</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:#24392d;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{height:70px;border-bottom:1px solid #dde2d7;display:flex;align-items:center;justify-content:space-between;padding:0 52px;background:#fcfcf8}header b{font-size:18px}header span{font-size:12px;color:#8b927f}main{max-width:1176px;margin:38px auto;padding:0 24px}.eyebrow{font-size:11px;letter-spacing:2px;color:#819073}h1{font-size:36px;line-height:1.35;margin:16px 0;color:#1e382a}.lead{font-size:17px;color:#78806f;line-height:1.9;max-width:1000px}.columns{display:grid;grid-template-columns:660px 1fr;gap:42px;margin-top:28px}#excerpt{background:#fff;border:1px solid #dce3d4;border-radius:12px;padding:25px 28px}#excerpt h2{font-size:24px;margin:0 0 22px}#excerpt section{display:flex;gap:18px;align-items:flex-start;padding:15px 0;border-top:1px solid #edf0e9}#excerpt section>span{font-size:13px;color:#95a385;padding-top:4px}#excerpt h3{font-size:19px;margin:0 0 7px}#excerpt p{font-size:15px;color:#7a856f;line-height:1.8;margin:0}aside{padding-top:18px}aside h2{font-size:20px}aside p{font-size:16px;line-height:1.9;color:#7d876f}.hint{border-left:3px solid #a9b996;padding:14px 20px;background:#edf2e5;margin-top:24px}footer{max-width:1128px;margin:28px auto;color:#9aa28f;font-size:12px}</style>
<header><b>文献阅读手册</b><span>演示文章 · 用于展示笔记功能</span></header><main><div class="eyebrow">READING NOTES / 理解与记录</div><h1>读懂一篇材料，先分清三件事</h1><p class="lead">把结论、证据和适用条件分开记录，再补上自己的问题，回顾时就能沿着论证继续思考。</p><div class="columns"><div id="excerpt"><h2>从主张走向可检验的理解</h2><section><span>01</span><div><h3>核心主张：作者想说明什么？</h3><p>用一句话写清观点，保留它与原材料的联系。</p></div></section><section><span>02</span><div><h3>支持证据：依据来自哪里？</h3><p>截下关键图表或原文，在旁边记下它支持的判断。</p></div></section><section><span>03</span><div><h3>适用边界：什么条件下成立？</h3><p>把限制条件与自己的疑问放在一起，留待继续查证。</p></div></section></div><aside><h2>让笔记保留思考的过程</h2><p>阅读时先留下当下的理解。截图、短句、圈画和问题可以放在同一张画布上，之后再整理成系统的内容。</p><div class="hint"><p>读到重要之处就记录，不必先决定整篇笔记的目录。</p></div></aside></div></main><footer>示例内容 · 不含个人笔记或第三方文章</footer></html>`;
const browser = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 960 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  args: [
    '--window-size=1280,960',
    '--disable-extensions-except=' + extension,
    '--load-extension=' + extension,
  ],
});
const errors = [],
  output = resolve('docs/images');
await mkdir(output, { recursive: true });
let panel;
try {
  await browser.route(articleUrl, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: articleHtml }),
  );
  const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker')),
    id = worker.url().split('/')[2];
  const options = await browser.newPage();
  await options.goto('chrome-extension://' + id + '/options.html');
  await options.getByRole('button', { name: '连接本机 DSH', exact: true }).click();
  for (let i = 0; !bridge.info().pending.length && i < 60; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const pending = bridge.info().pending[0];
  if (!pending) throw new Error('Documentation browser pairing was not created');
  await bridge.connections.approve(pending.id);
  await options.getByText('已连接并记住此浏览器，以后打开 DSH 会自动连接。', { exact: true }).waitFor();
  const article = await browser.newPage();
  await article.goto(articleUrl);
  await article.evaluate(() => document.fonts.ready);
  const imageBytes = await article.locator('#excerpt').screenshot(),
    image = decode(imageBytes);
  const tab = await options.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url),
    articleUrl,
  );
  const note = await store.create({
    title: '论文阅读：结论、证据与边界',
    source: { url: articleUrl, title: '读懂一篇材料：结论、证据与边界' },
  });
  const context = {
    id: note.id,
    title: note.title,
    url: articleUrl,
    tabId: tab.id,
    windowId: tab.windowId,
    status: 'ready',
  };
  await options.evaluate(
    (context) => chrome.runtime.sendMessage({ action: 'bind-tab-note', context }),
    context,
  );
  const notes =
    '这篇材料的主线\n把“作者的判断”“支持它的证据”和“成立的条件”分开。\n\n我想记住的联系\n截图负责保留原始信息，画布旁的备注记录我的理解。\n\n继续追问\n如果换一组材料，这个结论还成立吗？\n有哪些信息值得带到下一次复习？';
  await store.dispatch({ action: 'saveWebNotes', id: note.id, url: articleUrl, text: notes, baseVersion: 0 });
  panel = await browser.newPage();
  panel.on('pageerror', (error) => errors.push(error.message));
  await panel.setViewportSize({ width: 460, height: 760 });
  await panel.goto('chrome-extension://' + id + '/sidepanel.html?tabId=' + tab.id);
  await panel.locator('#canvas-loading').waitFor({ state: 'hidden' });
  await panel.waitForFunction(() => window.__docsCanvas);
  await panel.getByRole('tab', { name: '随手记', exact: true }).click();
  await panel.waitForFunction(() => document.querySelector('#notes').value.includes('这篇材料的主线'));
  await panel.mouse.move(450, 740);
  await panel.screenshot({ path: join(output, 'chrome-sidepanel.png') });

  const screenshot = await store.dispatch({
    action: 'addWebImage',
    id: note.id,
    url: articleUrl,
    requestId: 'documentation-screenshot-001',
    dataURL: 'data:image/png;base64,' + imageBytes.toString('base64'),
    preview: 'data:image/png;base64,' + imageBytes.toString('base64'),
    width: image.width,
    height: image.height,
    caption: '结论、证据与边界',
  });
  await panel.setViewportSize({ width: 1280, height: 900 });
  await panel.reload();
  await panel.getByRole('tab', { name: '手写画布', exact: true }).click();
  await panel.waitForFunction(() => window.__docsCanvas);
  await panel.getByRole('button', { name: '专注画布', exact: true }).click();
  await panel.evaluate(() => {
    const api = window.__docsCanvas;
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((e) =>
          e.type === 'image'
            ? { ...e, x: 60, y: 80, width: 580, height: (e.height * 580) / e.width, version: e.version + 1 }
            : e,
        ),
      appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, selectedElementIds: {} },
      captureUpdate: 'IMMEDIATELY',
    });
    api.setActiveTool({ type: 'selection' });
  });
  const resetViewport = async () => {
    await panel.evaluate(() =>
      window.__docsCanvas.updateScene({
        appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, selectedElementIds: {} },
      }),
    );
    await panel.waitForTimeout(120);
  };
  const toViewport = (point) =>
    panel.evaluate((point) => {
      const s = window.__docsCanvas.getAppState();
      return {
        x: s.offsetLeft + (point.x + s.scrollX) * s.zoom.value,
        y: s.offsetTop + (point.y + s.scrollY) * s.zoom.value,
      };
    }, point);
  const place = async (area) => {
    await panel.getByRole('button', { name: '选择摆放区域', exact: true }).click();
    const overlay = panel.getByRole('application', { name: '选择学习控件摆放区域' });
    await overlay.waitFor();
    const a = await toViewport(area),
      b = await toViewport({ x: area.x + area.width, y: area.y + area.height });
    await panel.mouse.move(a.x, a.y);
    await panel.mouse.down();
    await panel.mouse.move(b.x, b.y, { steps: 8 });
    await panel.mouse.up();
    await overlay.waitFor({ state: 'hidden' });
  };
  await panel.locator('#focus-learning').click();
  await panel.getByRole('button', { name: /^知识点/ }).click();
  await panel.getByRole('textbox', { name: '卡片标题（可留空）', exact: true }).fill('我的阅读提纲');
  for (const [i, title] of ['先写清核心主张', '给关键证据留出处', '记录成立条件与疑问'].entries())
    await panel.getByRole('textbox', { name: '知识点 ' + (i + 1), exact: true }).fill(title);
  await place({ x: 730, y: 80, width: 430, height: 270 });
  await resetViewport();
  await panel.locator('#focus-learning').click();
  await panel.getByRole('button', { name: /^提问卡/ }).click();
  await panel.getByRole('textbox', { name: /^问题/ }).fill('如果改变一个条件，结论还成立吗？');
  await panel
    .getByRole('textbox', { name: '参考答案（可留空）', exact: true })
    .fill('回到原文，逐条检查证据能支持到哪里。');
  await place({ x: 730, y: 400, width: 430, height: 210 });
  await resetViewport();
  await panel.getByRole('button', { name: '画笔', exact: true }).click();
  const points = Array.from({ length: 45 }, (_, i) => {
    const t = (i / 44) * Math.PI * 2;
    return { x: 350 + 238 * Math.cos(t), y: 267 + 40 * Math.sin(t) };
  });
  const first = await toViewport(points[0]);
  await panel.mouse.move(first.x, first.y);
  await panel.mouse.down();
  for (const point of points.slice(1)) {
    const screen = await toViewport(point);
    await panel.mouse.move(screen.x, screen.y);
  }
  await panel.mouse.up();
  await panel.getByRole('button', { name: '选择', exact: true }).click();
  await panel.evaluate(() => {
    const api = window.__docsCanvas;
    api.updateScene({ appState: { selectedElementIds: {} } });
    api.scrollToContent(api.getSceneElements(), {
      fitToViewport: true,
      viewportZoomFactor: 0.88,
      maxZoom: 1,
    });
  });
  await panel.evaluate(() => window.__docsCanvas.setToast(null));
  await panel.mouse.move(1260, 880);
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: join(output, 'chrome-canvas.png') });
  await panel.evaluate(() => {
    const api = window.__docsCanvas,
      image = api.getSceneElements().find((e) => e.type === 'image');
    api.updateScene({ appState: { selectedElementIds: { [image.id]: true } } });
  });
  await panel.getByRole('button', { name: '提问 / 备注', exact: true }).click();
  await panel
    .getByRole('textbox', { name: '提问或备注', exact: true })
    .fill('这张图帮助我把作者的结论、支持证据和适用条件分开记录。下次阅读可以沿着这三条线检查。');
  await panel.getByRole('button', { name: '留下备注', exact: true }).click();
  await panel.locator('.study-comment-message.note').waitFor();
  await panel
    .getByRole('textbox', { name: '提问或备注', exact: true })
    .fill('证据充分，就一定能推出作者的结论吗？');
  await panel.mouse.move(1260, 880);
  await panel.screenshot({ path: join(output, 'chrome-comments.png') });
  await panel.getByRole('button', { name: '关闭画布备注', exact: true }).click();
  await panel.locator('#focus-exit').click();
  await panel.getByRole('button', { name: '保存', exact: true }).first().click();
  await panel.getByRole('tab', { name: '随手记', exact: true }).click();

  await options.evaluate(() => chrome.storage.local.set({ studyboardMode: 'notes', dockHeight: 450 }));
  await article.bringToFront();
  // Call the same docking message as the UI button after making the source tab active.
  const docked = await options.evaluate(
    (context) => chrome.runtime.sendMessage({ action: 'open-bottom', context }),
    context,
  );
  if (!docked?.ok) throw new Error(docked?.error || 'Bottom panel did not open');
  await article.locator('#__studyboard_bottom').waitFor();
  const bottom = article.frames().find((frame) => frame.url().includes('surface=bottom'));
  if (!bottom) throw new Error('Missing actual extension iframe');
  await bottom.locator('#notes').waitFor();
  await bottom.waitForFunction(() => document.querySelector('#notes').value.includes('这篇材料的主线'));
  await article.mouse.move(1255, 35);
  await article.screenshot({ path: join(output, 'chrome-bottom.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      generated: ['chrome-sidepanel.png', 'chrome-canvas.png', 'chrome-bottom.png', 'chrome-comments.png'],
      realExtensionUi: true,
      syntheticMaterial: true,
      productionDataUsed: false,
      imageAdded: !!screenshot.image.id,
    }),
  );
} catch (error) {
  await mkdir('dist/qa', { recursive: true });
  if (panel) await panel.screenshot({ path: 'dist/qa/readme-capture-failure.png' });
  throw error;
} finally {
  await browser.close();
  await runtime.dispose();
  await bridge.close();
}
