import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('icon.svg', 'utf8'),
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await mkdir('chrome-extension/icons', { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(svg);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        return c.toDataURL().split(',')[1];
      },
      { svg, size },
    );
    await writeFile('chrome-extension/icons/icon-' + size + '.png', Buffer.from(png, 'base64'));
  }
} finally {
  await browser.close();
}
