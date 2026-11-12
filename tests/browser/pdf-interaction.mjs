import assert from 'node:assert/strict';

export async function assertPdfKeyboardAndWindowDrag(page) {
  // Match the desktop host's native drag-region CSS, including inherited no-drag.
  await page.evaluate(() => (document.documentElement.dataset.platform = 'darwin'));
  const hostStyle = await page.addStyleTag({
    content: `
    html[data-platform=darwin]{--dsh-frame-top-clearance:48px}
    html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}
    html[data-platform=darwin] body>:not(#root),
    html[data-platform=darwin] :is(button,a,input,select,textarea,summary,[contenteditable=true],[tabindex],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tab],[role=button],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=combobox],[role=textbox]){-webkit-app-region:no-drag}
  `,
  });
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  const drag = await page.evaluate(() => {
    const header = document.querySelector('.sb-board-header'),
      box = header.getBoundingClientRect();
    const blocked = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.left < box.right &&
          r.right > box.left &&
          r.top < box.top + 40 &&
          r.bottom > box.top &&
          getComputedStyle(e).getPropertyValue('-webkit-app-region') === 'no-drag'
        );
      })
      .map((e) => ({ tag: e.tagName, className: e.className }));
    return {
      header: getComputedStyle(header).getPropertyValue('-webkit-app-region'),
      editor: getComputedStyle(document.querySelector('.excalidraw')).getPropertyValue('-webkit-app-region'),
      trail: getComputedStyle(document.querySelector('.SVGLayer')).getPropertyValue('-webkit-app-region'),
      blocked,
    };
  });
  assert.equal(drag.header, 'drag');
  assert.equal(drag.editor, 'no-drag', 'Canvas must keep normal drawing input');
  assert.notEqual(drag.trail, 'no-drag', 'Transparent trail layer must not mask the window titlebar');
  assert.deepEqual(
    drag.blocked,
    [],
    'Invisible canvas UI covers the titlebar: ' + JSON.stringify(drag.blocked),
  );
  await page.waitForFunction(() =>
    [...window.__pdfTestFrames.entries].some(([key, entry]) => key.startsWith('2:') && entry.value),
  );
  const cachedNext = await page.evaluate(
    () => [...window.__pdfTestFrames.entries].find(([key, entry]) => key.startsWith('2:') && entry.value)[0],
  );
  const pageInput = page.getByRole('spinbutton', { name: 'PDF 页码' }),
    reader = page.getByLabel('PDF 阅读区', { exact: true });
  // A normal click in the page gives only the reader ownership of navigation keys.
  const viewport = await reader.boundingBox();
  await page.mouse.click(viewport.x + 40, viewport.y + 40);
  assert.equal(await reader.evaluate((e) => document.activeElement === e), true);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === '2');
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  assert.equal(
    await page.evaluate((key) => window.__pdfTestFrames.current === key, cachedNext),
    true,
    'Turning forward reuses the prepared page',
  );
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === '1');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageInput.inputValue(), '1');
  await page.getByRole('textbox', { name: '搜索 PDF' }).fill('boundary');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageInput.inputValue(), '1', 'Search editing must not turn the page');
  await page.getByRole('textbox', { name: '搜索 PDF' }).fill('');
  await reader.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await pageInput.inputValue(), '1', 'Modified arrows keep their normal meaning');
  await pageInput.fill('4');
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  await reader.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageInput.inputValue(), '4');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === '3');
  await pageInput.fill('1');
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  // Leave the test host as it was for the rest of the PDF workflow.
  await hostStyle.evaluate((e) => e.remove());
  await page.evaluate(() => delete document.documentElement.dataset.platform);
  return { windowDragRegion: true, pdfArrowKeys: true, inputKeysPreserved: true };
}
