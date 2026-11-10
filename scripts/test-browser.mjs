import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { LibraryStore } from '../core.js';
import { LearningStore } from '../learning.js';
import { LearningRuntime } from '../server/runtime.js';
import { CaptureServer } from '../capture-server.js';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';
const root = resolve('.'),
  temp = await mkdtemp(join(tmpdir(), 'studyboard-browser-')),
  extension = join(temp, 'extension');
await cp('chrome-extension', extension, {
  recursive: true,
  filter: (src) => !/(?:connection\.json(?:\.bak)?|\.log)$/.test(src),
});
const store = await new LibraryStore(join(temp, 'data')).init(),
  learning = await new LearningStore(store).init(),
  runtime = await new LearningRuntime({ llm: { listProviders: () => [] } }, store, learning, {
    gateway: {
      async text() {
        return {
          text: '先独立回忆，再用证据核对遗漏。',
          model: { id: 'browser-fixture', provider: 'fixture', name: '浏览器测试模型' },
        };
      },
    },
  }).init();
const bridge = new CaptureServer(store, { port: 0 });
bridge.moduleAction = (request) => runtime.execute(request);
await bridge.start();
for (const file of ['options.html', 'options.js'])
  await writeFile(
    join(extension, file),
    (await readFile(join(extension, file), 'utf8')).replaceAll('43127', String(bridge.port)),
  );
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const base = {
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  minify: true,
  plugins: [excalidrawChinese(), excalidrawCancellation()],
};
await build({ ...base, entryPoints: ['tests/browser/entry.jsx'], outfile: join(temp, 'dsh.js') });
await build({
  ...base,
  entryPoints: ['src/chrome-canvas.jsx'],
  outfile: join(extension, 'canvas.js'),
  plugins: [
    {
      name: 'isolated-qa-api',
      setup(b) {
        b.onLoad({ filter: /chrome-canvas\.jsx$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'api = value;',
            'api = value; window.__qaCanvas = value;',
          ),
          loader: 'jsx',
          resolveDir: join(root, 'src'),
        }));
      },
    },
    ...base.plugins,
  ],
});
const html =
  '<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;font-family:system-ui}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fafafa;--dsw-alias-border-l1:#eceef0;--dsw-alias-border-l2:#dcdfe2;--dsw-alias-label-primary:#17181b;--dsw-alias-label-secondary:#60656c;--dsw-alias-label-tertiary:#868b93;--dsw-alias-brand-primary:#15161a;--dsw-alias-button-primary-fill:#15161a;--dsw-alias-label-inverse:#fff}</style><div id="root"></div><script src="/dsh.js"></script>';
const web = createServer(async (req, res) => {
  try {
    if (req.url === '/qa-api') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { method, args } = JSON.parse(Buffer.concat(chunks));
      let value;
      if (method === 'models') value = [];
      else if (method === 'captureInfo') value = bridge.info();
      else if (method === 'capturePairing') {
        const r = args[0];
        value = await bridge.connections[r.action](r.id);
      } else {
        const r = args[0];
        value =
          r.action === 'summaryTask'
            ? null
            : r.action === 'graph'
              ? { ...(await learning.graph()), aiJob: null }
              : runtime.has(r.action)
                ? await runtime.execute(r)
                : await learning.dispatch(r);
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, value }));
      return;
    }
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (req.url === '/article') {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><title>学习方法测试材料</title><h1>主动回忆</h1><p>先尝试回忆，再核对资料。</p>',
      );
      return;
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = req.url === '/dsh.js' ? join(temp, 'dsh.js') : join(extension, decodeURIComponent(req.url));
    res.setHeader('content-type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(path));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { message: error.message } }));
  }
});
await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + web.address().port;
const browser = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [
    '--window-size=1280,800',
    '--disable-extensions-except=' + extension,
    '--load-extension=' + extension,
  ],
});
const errors = [];
let panel;
try {
  const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker')),
    id = worker.url().split('/')[2],
    dsh = await browser.newPage();
  dsh.on('pageerror', (e) => errors.push(e.message));
  await dsh.goto(origin);
  await dsh.getByRole('button', { name: '浏览器快捷笔记', exact: true }).click();
  const options = await browser.newPage();
  options.on('pageerror', (e) => errors.push(e.message));
  await options.goto('chrome-extension://' + id + '/options.html');
  await options.getByRole('button', { name: '连接本机 DSH', exact: true }).click();
  await dsh.getByRole('button', { name: '允许连接', exact: true }).click();
  await options.getByText('已连接并记住此浏览器，以后打开 DSH 会自动连接。', { exact: true }).waitFor();
  assert.equal(bridge.info().clients.length, 1);
  assert.equal(bridge.info().clients[0].extensionId, id);
  const article = await browser.newPage();
  await article.goto(origin + '/article');
  const tab = await options.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url),
    origin + '/article',
  );
  const note = await store.create({ title: '浏览器画布测试', source: { url: origin + '/article' } }),
    context = {
      id: note.id,
      title: note.title,
      url: note.source.url,
      tabId: tab.id,
      windowId: tab.windowId,
      status: 'ready',
    };
  await options.evaluate(
    (context) => chrome.runtime.sendMessage({ action: 'bind-tab-note', context }),
    context,
  );
  panel = await browser.newPage();
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto('chrome-extension://' + id + '/sidepanel.html?tabId=' + tab.id);
  await panel.locator('#canvas-loading').waitFor({ state: 'hidden' });
  await panel.waitForFunction(() => window.__qaCanvas);
  await panel.getByRole('button', { name: '专注画布', exact: true }).click();
  await panel.locator('#focus-learning').click();
  await panel.getByRole('button', { name: /^知识点/ }).click();
  await panel.getByRole('textbox', { name: '知识点 1', exact: true }).fill('先回忆');
  await panel.getByRole('textbox', { name: '知识点 2', exact: true }).fill('再核对');
  await panel.getByRole('button', { name: '选择摆放区域', exact: true }).click();
  const overlay = panel.getByRole('application', { name: '选择学习控件摆放区域' });
  await overlay.click({ position: { x: 350, y: 150 } });
  await overlay.waitFor({ state: 'hidden' });
  await panel.locator('.excalidraw').focus();
  await panel.keyboard.press('Enter');
  await panel.getByRole('textbox', { name: '知识点 1', exact: true }).fill('主动回忆');
  await panel.getByRole('button', { name: '更新并排版', exact: true }).click();
  const layout = await panel.evaluate(() => {
    const a = document.querySelector('.study-tools').getBoundingClientRect(),
      b = document.querySelector('.excalidraw').getBoundingClientRect();
    return { toolbarBottom: a.bottom, canvasTop: b.top };
  });
  assert.ok(layout.toolbarBottom <= layout.canvasTop + 1);
  await panel.locator('#focus-exit').click();
  await panel.getByRole('button', { name: '保存', exact: true }).first().click();
  let saved;
  for (let i = 0; i < 100; i++) {
    saved = await store.read(note.id);
    if (saved.scene.elements.some((e) => e.text === '主动回忆')) break;
    await panel.waitForTimeout(50);
  }
  assert.ok(saved.scene.elements.some((e) => e.text === '主动回忆'));
  await panel.reload();
  await panel.waitForFunction(() => window.__qaCanvas);
  assert.ok(
    await panel.evaluate(() => window.__qaCanvas.getSceneElements().some((e) => e.text === '主动回忆')),
  );
  const libraryPosition = await panel.evaluate(() => {
    const button = document.querySelector('.default-sidebar-trigger').getBoundingClientRect(),
      canvas = document.querySelector('.excalidraw').getBoundingClientRect();
    return { gap: canvas.right - button.right, left: button.left, right: canvas.right };
  });
  assert.ok(libraryPosition.gap < 40, JSON.stringify(libraryPosition));
  await panel.evaluate(() => {
    const api = window.__qaCanvas,
      template = api.getSceneElements().find((e) => e.type === 'text');
    const text = '理解材料时，先找到核心主张和证据，再核对成立条件。'.repeat(40);
    api.updateScene({
      elements: [
        ...api.getSceneElements(),
        {
          ...template,
          id: 'qa-long',
          x: 40,
          y: 600,
          width: 18000,
          height: 25,
          fontSize: 20,
          lineHeight: 1.25,
          text,
          originalText: text,
          containerId: null,
          groupIds: [],
          customData: {},
          autoResize: true,
          angle: 0,
          version: 1,
          versionNonce: 1234,
        },
      ],
      appState: { selectedElementIds: {} },
      captureUpdate: 'IMMEDIATELY',
    });
  });
  await panel.waitForFunction(
    () => window.__qaCanvas.getSceneElements().find((e) => e.id === 'qa-long')?.width < 900,
  );
  await panel.locator('.excalidraw').focus();
  const modifier = await panel.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'));
  await panel.keyboard.press(modifier + '+z');
  await panel.waitForFunction(() => {
    const e = window.__qaCanvas.getSceneElements().find((e) => e.id === 'qa-long');
    return !e || e.width > 900;
  });
  await panel.waitForTimeout(150);
  assert.ok(
    await panel.evaluate(() => {
      const e = window.__qaCanvas.getSceneElements().find((e) => e.id === 'qa-long');
      return !e || e.width > 900;
    }),
  );
  await panel.keyboard.press(modifier + '+Shift+z');
  await panel.waitForFunction(
    () => window.__qaCanvas.getSceneElements().find((e) => e.id === 'qa-long')?.width < 900,
  );
  await panel.getByRole('button', { name: '保存', exact: true }).first().click();
  for (let i = 0; i < 100; i++) {
    const persisted = (await store.read(note.id)).scene.elements.find((e) => e.id === 'qa-long');
    if (persisted?.text.includes('\n') && persisted.autoResize === false) break;
    if (i === 99) throw new Error('Wrapped text was not saved: ' + JSON.stringify(persisted));
    await panel.waitForTimeout(50);
  }
  await panel.reload();
  await panel.waitForFunction(() => window.__qaCanvas);
  await panel.waitForFunction(() =>
    window.__qaCanvas
      .getSceneElements()
      .find((e) => e.id === 'qa-long')
      ?.text.includes('\n'),
  );
  await panel.evaluate(() => {
    const api = window.__qaCanvas;
    api.updateScene({
      appState: { selectedElementIds: { 'qa-long': true }, scrollX: 0, scrollY: -500, zoom: { value: 1 } },
    });
  });
  await panel.getByRole('button', { name: '提问 / 备注', exact: true }).click();
  await panel.getByRole('textbox', { name: '提问或备注', exact: true }).fill('核对主张和证据之间的关系');
  await panel.getByRole('button', { name: '留下备注', exact: true }).click();
  await panel
    .locator('.study-comment-message.note')
    .getByText('核对主张和证据之间的关系', { exact: true })
    .waitFor();
  await panel.getByRole('textbox', { name: '提问或备注', exact: true }).fill('如何检查我的理解？');
  await panel.getByRole('button', { name: '问 AI', exact: true }).click();
  await panel
    .locator('.study-comment-message.assistant')
    .getByText('先独立回忆，再用证据核对遗漏。', { exact: true })
    .waitFor();
  await panel.getByRole('button', { name: '关闭画布备注', exact: true }).click();
  const beforePin = await panel.locator('.study-comment-pin').boundingBox();
  assert.ok(beforePin);
  await panel.evaluate(() => {
    const api = window.__qaCanvas;
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((e) => (e.id === 'qa-long' ? { ...e, x: e.x + 30, y: e.y + 20, version: e.version + 1 } : e)),
    });
  });
  await panel.waitForFunction(
    (x) => Math.abs(document.querySelector('.study-comment-pin').getBoundingClientRect().left - x - 30) < 2,
    beforePin.x,
  );
  await panel.getByRole('button', { name: '保存', exact: true }).first().click();
  await panel.reload();
  await panel.waitForFunction(() => window.__qaCanvas);
  await panel.getByRole('button', { name: '画布备注列表', exact: true }).click();
  await panel
    .locator('.study-comment-list-item')
    .getByText('核对主张和证据之间的关系', { exact: true })
    .click();
  await panel.locator('.study-comment-message.assistant').waitFor();
  await panel.getByRole('button', { name: '标记已解决', exact: true }).click();
  await panel.getByRole('button', { name: '重新打开', exact: true }).waitFor();
  await panel.getByRole('button', { name: '重新打开', exact: true }).click();
  await panel.getByRole('textbox', { name: '提问或备注', exact: true }).waitFor();
  await panel.setViewportSize({ width: 440, height: 800 });
  const commentBox = await panel.getByRole('dialog', { name: '画布提问与备注' }).boundingBox();
  assert.ok(commentBox.x >= 0 && commentBox.x + commentBox.width <= 440);
  await panel.screenshot({ path: join(temp, 'comments-narrow.png') });
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.getByRole('button', { name: '关闭画布备注', exact: true }).click();
  if (process.platform === 'darwin') {
    const dataURL = await panel.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 680;
      canvas.height = 180;
      const context = canvas.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, 680, 180);
      context.fillStyle = 'black';
      context.font = '42px sans-serif';
      context.fillText('先回忆，再核对资料', 25, 100);
      return canvas.toDataURL();
    });
    const recognized = await runtime.native.read(Buffer.from(dataURL.split(',')[1], 'base64'));
    assert.ok(recognized.lines.some((line) => line.text.includes('回忆')));
  }
  await mkdir('dist/qa', { recursive: true });
  await panel.screenshot({ path: 'dist/qa/browser-smoke.png' });
  await dsh.getByRole('button', { name: '断开此连接', exact: true }).click();
  await dsh.getByText('尚未连接浏览器。', { exact: true }).waitFor();
  assert.equal(bridge.info().clients.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      pairing: true,
      revoke: true,
      canvasCreateEditSaveReload: true,
      toolbarOutsideCanvas: true,
      libraryAligned: true,
      longTextWrapPersists: true,
      componentComments: true,
      commentAnchorFollowsMove: true,
    }),
  );
} catch (error) {
  await mkdir('dist/qa', { recursive: true });
  if (panel) await panel.screenshot({ path: 'dist/qa/browser-failure.png' });
  if (panel)
    await writeFile(
      'dist/qa/browser-state.json',
      JSON.stringify(
        await panel.evaluate(() => ({
          elements: window.__qaCanvas?.getSceneElements(),
          state: {
            width: window.__qaCanvas?.getAppState().width,
            zoom: window.__qaCanvas?.getAppState().zoom,
          },
        })),
        null,
        2,
      ),
    );
  throw error;
} finally {
  await browser.close();
  await runtime.dispose();
  await bridge.close();
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
}
