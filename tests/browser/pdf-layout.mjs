import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';

/** Landscape reports can fit exactly until the loading label creates a scrollbar. */
export async function assertPdfLayoutStable(page) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [960, 540] });
  pdf.setFontSize(24);
  pdf.text('Landscape report layout regression', 48, 60);
  for (let i = 0; i < 1200; i++) {
    pdf.setFillColor(80 + (i % 100), 140, 170);
    pdf.rect(48 + (i % 80) * 10, 100 + Math.floor(i / 80) * 20, 7, 12, 'F');
  }
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByLabel('导入 PDF 新建笔记', { exact: true }).setInputFiles({
    name: 'landscape-layout.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf.output('arraybuffer')),
  });
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  // Match platforms configured to always show scrollbars, including external mice.
  await page.addStyleTag({
    content:
      '.sb-pdf-scroll::-webkit-scrollbar{width:16px;height:16px}.sb-pdf-scroll::-webkit-scrollbar-thumb{background:#bbb}',
  });
  const height = await page.evaluate(() => {
    const scroller = document.querySelector('.sb-pdf-scroll');
    return Math.round(
      window.innerHeight - scroller.clientHeight + ((scroller.clientWidth - 32) * 540) / 960 + 32 + 24,
    );
  });
  await page.setViewportSize({ ...page.viewportSize(), height });
  await page.evaluate(() => {
    const scroller = document.querySelector('.sb-pdf-scroll');
    window.__pdfLoadingOffsets = [];
    const reader = document.querySelector('.sb-pdf-reader'),
      sheet = document.querySelector('.sb-pdf-page');
    window.__pdfLayoutObserver = new MutationObserver(() => {
      if (reader.querySelector('.sb-pdf-loading'))
        window.__pdfLoadingOffsets.push(
          sheet.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop -
            parseFloat(getComputedStyle(scroller).paddingTop),
        );
    });
    window.__pdfLayoutObserver.observe(reader, { subtree: true, childList: true, attributes: true });
  });
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('1');
  await page.locator('.sb-pdf-page[data-ready="true"]').waitFor();
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('fit');
  const result = await page.evaluate(async () => {
    const raster = document.querySelector('.sb-pdf-page > canvas'),
      sheet = document.querySelector('.sb-pdf-page'),
      scroller = document.querySelector('.sb-pdf-scroll');
    let frame = 0,
      lateRasterWrites = 0,
      loadingFrames = 0;
    const positions = [],
      widths = new Set();
    const observer = new MutationObserver((records) => {
      if (frame > 30) lateRasterWrites += records.length;
    });
    observer.observe(raster, { attributes: true, attributeFilter: ['width', 'height'] });
    for (; frame < 150; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (frame > 30) {
        positions.push(sheet.getBoundingClientRect().top);
        widths.add(scroller.clientWidth);
        if (document.querySelector('.sb-pdf-loading')) loadingFrames++;
      }
    }
    observer.disconnect();
    window.__pdfLayoutObserver.disconnect();
    return {
      lateRasterWrites,
      loadingFrames,
      widths: [...widths],
      pageShift: Math.max(...positions) - Math.min(...positions),
      loadingOffsets: [...new Set(window.__pdfLoadingOffsets)],
    };
  });
  assert.ok(result.loadingOffsets.length, 'Expected to observe actual PDF rendering');
  assert.ok(
    result.loadingOffsets.every((offset) => Math.abs(offset) < 1),
    'Loading label displaces PDF: ' + JSON.stringify(result),
  );
  assert.equal(result.lateRasterWrites, 0, 'PDF redraws while idle: ' + JSON.stringify(result));
  assert.ok(result.pageShift < 1, 'PDF moves while idle: ' + JSON.stringify(result));
  assert.equal(result.loadingFrames, 0, 'PDF loading label keeps returning: ' + JSON.stringify(result));
  await page.screenshot({ path: 'dist/qa/pdf-layout-stable.png' });
  return result;
}
