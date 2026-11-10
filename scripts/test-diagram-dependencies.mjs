import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const source = String.raw`
import {parseMermaidToExcalidraw} from '@excalidraw/mermaid-to-excalidraw';
import {jsPDF} from 'jspdf';
window.checkDiagrams = async () => {
  window.__studyboardXssCanary = 0;
  const cases = {
    flow: 'flowchart LR\nA[材料] --> B[理解]',
    sequence: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: 阅读后核对',
    math: 'flowchart LR\nA["$$x^2$$"] --> B["结果"]',
    untrustedLabel: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: <img src=x onerror="window.__studyboardXssCanary=1">'
  };
  const diagrams = {};
  for (const [name, text] of Object.entries(cases)) {
    const result = await parseMermaidToExcalidraw(text, {maxEdges:100,maxTextSize:5000});
    diagrams[name] = result.elements.length;
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = document.createElement('canvas'); canvas.width=120;canvas.height=80;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#153f2b';ctx.fillRect(0,0,120,80);
  const pdf=new jsPDF();pdf.addImage(canvas.toDataURL('image/png'),'PNG',10,10,120,80);
  const blob=pdf.output('blob');
  return {diagrams,canary:window.__studyboardXssCanary,unsafeHandlers:document.querySelectorAll('[onerror]').length,pdfPrefix:(await blob.text()).slice(0,5),pdfBytes:blob.size};
};`;
const compiled = await build({
  stdin: { contents: source, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'dataurl' },
  minify: true,
});
const server = createServer((req, res) => {
  if (req.url === '/entry.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(compiled.outputFiles[0].text);
  } else if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><meta charset="utf-8"><script src="/entry.js"></script>');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = 'http://127.0.0.1:' + server.address().port;
await page.route('**/*', (route) =>
  route
    .request()
    .url()
    .startsWith(base + '/')
    ? route.continue()
    : route.abort(),
);
try {
  await page.goto(base);
  const result = await page.evaluate(() => window.checkDiagrams());
  for (const [name, count] of Object.entries(result.diagrams)) assert(count > 0, name + ' did not convert');
  assert.equal(result.canary, 0);
  assert.equal(result.unsafeHandlers, 0);
  assert.equal(result.pdfPrefix, '%PDF-');
  assert(result.pdfBytes > 500);
  assert.deepEqual(errors, []);
  await mkdir('dist/qa', { recursive: true });
  await writeFile('dist/qa/diagram-dependencies.json', JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  server.close();
}
