import assert from 'node:assert/strict';
import { canvasQuotes } from '../../shared/canvas-quotes.js';

async function selectCanvasText(panel, id) {
  await panel.waitForFunction((id) => window.__qaCanvas?.getSceneElements().some((e) => e.id === id), id);
  await panel.evaluate((id) => {
    const api = window.__qaCanvas;
    api.updateScene({ appState: { selectedElementIds: { [id]: true }, selectedGroupIds: {} } });
  }, id);
}
async function saveConversion(panel, action, text) {
  const saved = panel.waitForResponse(
    (r) =>
      r.url().endsWith('/note/canvas/save') &&
      r.request().method() === 'POST' &&
      r
        .request()
        .postDataJSON()
        ?.scene.elements.some((e) => !e.isDeleted && e.customData?.studyboard?.values?.text === text),
  );
  await panel.getByRole('button', { name: action, exact: true }).click();
  await panel.getByRole('button', { name: '保存', exact: true }).first().click();
  assert.ok((await saved).ok());
}

export async function checkSelectionCapture({ panel, article, options, tab, store, learning, note, dsh }) {
  await panel.getByRole('tab', { name: '手写画布' }).click();
  await panel.waitForFunction(() =>
    window.__qaCanvas?.getSceneElements().some((e) => e.id === 'old-long-text'),
  );
  await options.evaluate(async (tab) => {
    const { enableSelectionTool } = await import('./selection-capture.js');
    await enableSelectionTool(tab);
    await enableSelectionTool(tab);
  }, tab);
  const original = '  先独立回忆。\n\nKeep  these spaces.  ';
  await article.bringToFront();
  const selected = await article.evaluate((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    p.style.whiteSpace = 'pre-wrap';
    document.querySelector('article').append(p);
    const selection = window.getSelection(),
      range = document.createRange();
    range.selectNodeContents(p);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, original);
  assert.equal(selected, original);
  const clip = article.getByRole('button', { name: '普通摘录', exact: true });
  await clip.waitFor();
  assert.equal(await clip.count(), 1);
  assert.ok(!canvasQuotes((await store.read(note.id)).scene.elements).some((q) => q.text === selected));
  await panel.evaluate(() => {
    const api = window.__qaCanvas,
      elements = api.getSceneElements();
    const text = '摘录时正在编辑的画布文字';
    api.updateScene({
      elements: [
        ...elements,
        {
          ...elements.find((e) => e.id === 'old-long-text'),
          id: 'draft-during-clip',
          groupIds: [],
          index: null,
          text,
          originalText: text,
          customData: {},
          version: 1,
          versionNonce: 156,
        },
      ],
    });
  });
  const panelSave = panel.waitForResponse(
    (response) => response.url().endsWith('/capture/excerpt') && response.request().method() === 'POST',
  );
  await clip.click();
  assert.ok((await panelSave).ok());
  await article.getByRole('status').filter({ hasText: '已摘录到画布' }).waitFor();
  const received = await store.read(note.id);
  assert.ok(received.scene.elements.some((e) => e.id === 'draft-during-clip'));
  const plain = received.scene.elements.find((e) => e.originalText === original);
  assert.ok(plain.customData.studyboard.webSource);
  assert.equal(plain.link, tab.url);
  assert(!(await learning.dashboard()).cards.some((c) => c.answer === original));
  await panel.bringToFront();
  await selectCanvasText(panel, plain.id);
  await saveConversion(panel, '转为金句', original);
  const updated = await store.read(note.id);
  const quotes = canvasQuotes(updated.scene.elements).filter((q) => q.text === original);
  assert.equal(quotes.length, 1);
  const quote = quotes[0];
  assert.equal(quote.source, await article.title());
  const owner = updated.scene.elements.find((e) => e.id === quote.id);
  assert.equal(owner.link, tab.url);
  assert.deepEqual([owner.x, owner.y], [plain.x, plain.y]);
  const body = updated.scene.elements.find((e) => e.id === plain.id);
  assert.equal(body.customData.studyboard.widgetId, quote.id);
  assert.equal(updated.scene.elements.filter((e) => !e.isDeleted && e.originalText === original).length, 1);
  const card = (await learning.dashboard()).cards.find((c) => c.quoteElementId === quote.id);
  assert.equal(card.answer, original);
  assert.equal(card.boardId, note.id);
  await panel.waitForFunction(
    (id) =>
      window.__qaCanvas
        .getSceneElements()
        .some((e) => e.id === id && e.customData.studyboard.widget === 'quote'),
    quote.id,
  );
  await selectCanvasText(panel, 'draft-during-clip');
  await panel.locator('.excalidraw').focus();
  await panel.keyboard.press('Enter');
  const editor = panel.locator('textarea.excalidraw-wysiwyg');
  await editor.waitFor();
  const part = '正在编辑';
  await editor.evaluate((input, part) => {
    const offset = input.value.indexOf(part);
    input.focus();
    input.setSelectionRange(offset, offset + part.length);
  }, part);
  await saveConversion(panel, '选段记为金句', part);
  const withPart = await store.read(note.id);
  assert.equal(
    withPart.scene.elements.find((e) => e.id === 'draft-during-clip').originalText,
    '摘录时正在编辑的画布文字',
  );
  assert.equal(canvasQuotes(withPart.scene.elements).filter((q) => q.text === part).length, 1);
  assert((await learning.dashboard()).cards.some((c) => c.answer === part));
  await article.evaluate(() => {
    const field = document.createElement('div');
    field.contentEditable = 'true';
    field.textContent = '编辑中的私人草稿';
    document.body.append(field);
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await clip.waitFor({ state: 'hidden' });

  const standalone = await article.context().newPage();
  try {
    await standalone.goto(tab.url + '#right-click');
    const snapshot = await standalone.locator('article p').evaluate((p) => {
      const selection = window.getSelection(),
        range = document.createRange();
      range.selectNodeContents(p);
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    assert.equal(await standalone.getByRole('button', { name: '普通摘录' }).count(), 0);
    await options.evaluate(
      async ({ url, selectionText }) => {
        const { selectionMenuClick } = await import('./selection-capture.js');
        const menuItemId = 'studyboard-clip-selection';
        // A missing menu ID fails this call. Headless Chrome doesn't expose native menu clicks to Playwright.
        await new Promise((resolve, reject) =>
          chrome.contextMenus.update(menuItemId, { enabled: true }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          }),
        );
        const target = (await chrome.tabs.query({})).find((t) => t.url === url);
        await selectionMenuClick({ menuItemId, pageUrl: url, selectionText, frameId: 0 }, target);
      },
      { url: standalone.url(), selectionText: snapshot },
    );
    await standalone.getByRole('status').filter({ hasText: '已摘录到画布' }).waitFor();
    const { boards } = await store.all();
    const fresh = boards.filter((b) => b.source?.url === standalone.url());
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].scene.elements[0].originalText, snapshot);
    assert.deepEqual(canvasQuotes(fresh[0].scene.elements), []);
    const commands = await options.evaluate(() => chrome.commands.getAll());
    const excerptShortcut = commands
      .find((c) => c.name === 'studyboard-clip-selection')
      .shortcut.toUpperCase();
    const quoteShortcut = commands
      .find((c) => c.name === 'studyboard-quote-selection')
      .shortcut.toUpperCase();
    assert.match(excerptShortcut, /Z$/);
    assert.equal(quoteShortcut, excerptShortcut.replace(/Z$/, 'X'));
    await standalone.bringToFront();
    const sourceUrl = tab.url + '#embedded-passage';
    await standalone.evaluate((url) => {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.id = 'clip-frame';
      document.body.append(frame);
    }, sourceUrl);
    const paragraph = standalone.frameLocator('#clip-frame').locator('article p');
    await paragraph.click();
    const innerText = await paragraph.evaluate((p) => {
      p.textContent = '内嵌阅读材料的选区。';
      const range = document.createRange();
      range.selectNodeContents(p);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      return window.getSelection().toString();
    });
    const worker = options
      .context()
      .serviceWorkers()
      .find((w) => w.url().endsWith('/background.js'));
    async function runCommand(command) {
      await worker.evaluate(
        async ({ command, url }) => {
          if (!chrome.commands.onCommand.hasListener(globalThis.__qaCommand))
            throw new Error('Shortcut handler is not registered');
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url !== url) throw new Error('Shortcut is targeting the wrong tab');
          await globalThis.__qaCommand(command, tab);
        },
        { command, url: standalone.url() },
      );
    }
    await runCommand('studyboard-clip-selection');
    const beforeQuote = await store.read(fresh[0].id);
    const inner = beforeQuote.scene.elements.find((e) => e.originalText === innerText);
    assert.equal(inner.link, sourceUrl);
    assert.equal(canvasQuotes(beforeQuote.scene.elements).length, 0);
    await runCommand('studyboard-quote-selection');
    await standalone.getByRole('status').filter({ hasText: '已记为金句' }).waitFor();
    assert.ok(
      (await learning.dashboard()).cards.some((c) => c.boardId === fresh[0].id && c.answer === innerText),
    );
  } finally {
    await standalone.close();
  }
  const localBoard = await store.create({ title: '画布文本转金句测试' });
  await dsh.reload();
  await dsh.getByRole('heading', { name: localBoard.title, exact: true }).click();
  const tools = dsh.getByRole('toolbar', { name: '画布工具' });
  await tools.getByRole('button', { name: '文字', exact: true }).click();
  const surface = dsh.locator('.sb-canvas .excalidraw');
  const bounds = await surface.boundingBox();
  await dsh.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.55);
  const localText = '在画布上直接写下的原文。';
  const input = dsh.locator('textarea.excalidraw-wysiwyg');
  await input.fill(localText);
  await input.press('Escape');
  await tools.getByRole('button', { name: '转为金句', exact: true }).click();
  await dsh.getByRole('button', { name: '返回笔记', exact: true }).click();
  await dsh.getByRole('heading', { name: localBoard.title, exact: true }).waitFor();
  assert.ok(
    (await learning.dashboard()).cards.some((c) => c.boardId === localBoard.id && c.answer === localText),
  );
  await dsh.getByRole('button', { name: '浏览器快捷笔记', exact: true }).click();
}
