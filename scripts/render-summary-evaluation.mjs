import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { summaryEvaluationCases } from '../tests/summary-evaluation-fixture.mjs';

const output = resolve(process.argv[2] || 'dist/summary-evaluation');
await mkdir(output, { recursive: true });
const cases = [];
for (const item of summaryEvaluationCases) {
  const variants = [];
  for (const variant of ['baseline', 'candidate']) {
    try {
      const result = JSON.parse(await readFile(join(output, item.id, variant + '.json'), 'utf8'));
      if (result.ok) variants.push(result);
    } catch {}
  }
  if (!variants.length) continue;
  let image = '';
  if (item.svg)
    image =
      'data:image/png;base64,' + (await readFile(join(output, item.id, 'source.png'))).toString('base64');
  cases.push({ ...item, variants, image });
}
await build({
  absWorkingDir: resolve('.'),
  stdin: {
    resolveDir: resolve('.'),
    contents: `import {buildInfographicScene, infographicSvg} from './src/infographic-render.js';
import {diagramLayout} from './src/diagram-layout.js';
window.summaryPreview = {buildInfographicScene, infographicSvg, diagramLayout};`,
  },
  outfile: join(output, 'preview.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  minify: true,
  logLevel: 'warning',
});
const css = `*{box-sizing:border-box}body{margin:0;background:#f0f3f0;color:#24382c;font:16px/1.8 Arial,"PingFang SC",sans-serif}main{max-width:1680px;margin:auto;padding:32px}h1{font-size:30px}h2{font-size:23px;line-height:1.5}h3{font-size:19px}p{white-space:pre-wrap;margin:12px 0}details{margin:16px 0}summary{cursor:pointer;color:#496b54}.case{margin:36px 0 70px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.variant{min-width:0;background:white;padding:26px;border:1px solid #d8e1db;border-radius:12px}.label{font-weight:bold;color:#46654f}.meta,figcaption{font-size:13px;color:#6f7e73}.intro{padding:16px;background:#e7eee8;border-radius:8px}.content{border-top:1px solid #e1e8e3;margin-top:24px;padding-top:12px}figure{margin:24px 0}figure svg,figure img{display:block;max-width:100%;height:auto;margin:auto}.diagram svg{width:100%}.error{padding:12px;background:#fff0de;color:#8f461c}.review{margin-top:28px;border-top:1px solid #ddd}.review details{padding:12px 0;border-bottom:1px solid #eee}@media(max-width:900px){.pair{grid-template-columns:1fr}main{padding:16px}}`;
await writeFile(
  join(output, 'preview.html'),
  `<meta charset="utf-8"><title>总结提示词对照</title><style>${css}</style><main id="report"></main><script src="preview.js"></script>`,
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(output, 'preview.html')).href);
  const result = await page.evaluate(async (cases) => {
    const esc = (value) =>
      String(value || '').replace(
        /[&<>"']/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
      );
    const paragraph = (value) => (value ? '<p>' + esc(value) + '</p>' : '');
    const errors = [];
    const diagram = (figure, key) => {
      const g = window.summaryPreview.diagramLayout(figure, { availableWidth: 700 });
      const lines = (box, color, bold = false) =>
        '<text text-anchor="middle" x="' +
        box.x +
        '" y="' +
        (box.y - ((box.lines.length - 1) * box.lineHeight) / 2 + box.fontSize * 0.35) +
        '" fill="' +
        color +
        '" font-size="' +
        box.fontSize +
        '"' +
        (bold ? ' font-weight="bold"' : '') +
        '>' +
        box.lines
          .map(
            (line, i) =>
              '<tspan x="' + box.x + '" dy="' + (i ? box.lineHeight : 0) + '">' + esc(line) + '</tspan>',
          )
          .join('') +
        '</text>';
      return (
        '<figure class="diagram"><h4>' +
        esc(figure.title) +
        '</h4><svg style="max-width:' +
        g.width +
        'px" viewBox="0 0 ' +
        g.width +
        ' ' +
        g.height +
        '"><defs><marker id="' +
        key +
        '" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#547760"/></marker></defs>' +
        g.edges
          .map(
            (e) =>
              '<path d="' +
              e.points.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') +
              '" stroke="#547760" fill="none" marker-end="url(#' +
              key +
              ')"/>' +
              (e.label.width
                ? '<rect x="' +
                  (e.label.x - e.label.width / 2) +
                  '" y="' +
                  (e.label.y - e.label.height / 2) +
                  '" width="' +
                  e.label.width +
                  '" height="' +
                  e.label.height +
                  '" fill="white"/>' +
                  lines(e.label, '#6f7e73')
                : ''),
          )
          .join('') +
        g.nodes
          .map(
            (n) =>
              '<rect x="' +
              (n.x - n.width / 2) +
              '" y="' +
              (n.y - n.height / 2) +
              '" width="' +
              n.width +
              '" height="' +
              n.height +
              '" rx="8" fill="#f3f7f4" stroke="#c9d7cc"/>' +
              lines(n, '#24382c', true),
          )
          .join('') +
        '</svg><figcaption>' +
        esc(figure.caption) +
        '</figcaption></figure>'
      );
    };
    let html =
      '<h1>总结提示词对照</h1><p class="meta">合成材料 · 同一模型与推理等级 · 图形使用项目现有布局与信息图导出</p>';
    for (const item of cases) {
      html +=
        '<section class="case" id="' +
        item.id +
        '"><h2>' +
        esc(item.title) +
        '</h2><details><summary>原始材料与评价要点</summary>' +
        paragraph(item.text) +
        '<ul>' +
        item.review.map((x) => '<li>' + esc(x) + '</li>').join('') +
        '</ul></details><div class="pair">';
      for (const result of item.variants) {
        const s = result.study,
          rendered = new Set(),
          prefix = item.id + '-' + result.variant;
        const visuals = async (conceptId) => {
          let output = '';
          for (const [i, figure] of s.diagrams.entries())
            if (
              !rendered.has('d' + i) &&
              (conceptId === undefined ||
                (figure.placement === 'overview' ? !conceptId : figure.conceptIds[0] === conceptId))
            ) {
              output += diagram(figure, prefix + '-d' + i);
              rendered.add('d' + i);
            }
          for (const [i, figure] of s.sourceFigures.entries())
            if (!rendered.has('s' + i) && (conceptId === undefined || figure.conceptIds[0] === conceptId)) {
              output +=
                '<figure><img src="' +
                item.image +
                '" alt="' +
                esc(figure.title) +
                '"><figcaption>' +
                esc(figure.caption) +
                '</figcaption></figure>';
              rendered.add('s' + i);
            }
          for (const [i, figure] of s.infographics.entries())
            if (
              !rendered.has('i' + i) &&
              (conceptId === undefined ||
                (figure.placement === 'overview' ? !conceptId : figure.conceptIds[0] === conceptId))
            ) {
              try {
                const scene = await window.summaryPreview.buildInfographicScene({
                  id: prefix + '-i' + i,
                  summaryId: prefix,
                  figure,
                  assets: item.image ? { S01: { dataURL: item.image } } : {},
                });
                const svg = await window.summaryPreview.infographicSvg(scene);
                output +=
                  '<figure data-figure="' +
                  prefix +
                  '-i' +
                  i +
                  '">' +
                  svg.outerHTML +
                  '<figcaption>' +
                  esc(figure.caption) +
                  '</figcaption></figure>';
              } catch (error) {
                errors.push({
                  case: item.id,
                  variant: result.variant,
                  figure: figure.id,
                  error: error.message,
                });
                output += '<p class="error">配图渲染失败：' + esc(error.message) + '</p>';
              }
              rendered.add('i' + i);
            }
          return output;
        };
        html +=
          '<article class="variant"><div class="label">' +
          (result.variant === 'baseline' ? '字数限制移除后的旧版' : '新的通用提示词') +
          '</div><p class="meta">' +
          esc(result.model) +
          ' / ' +
          esc(result.effort) +
          ' · 正文 ' +
          result.counts.bodyCharacters +
          ' 字符</p><h2>' +
          esc(s.title) +
          '</h2><div class="intro">' +
          paragraph(s.overview) +
          '</div><ul>' +
          s.takeaways.map((t) => '<li>' + esc(t) + '</li>').join('') +
          '</ul>' +
          (await visuals(null));
        for (const c of s.concepts)
          html +=
            '<section class="content"><h3>' +
            esc(c.title) +
            '</h3>' +
            paragraph(c.explanation) +
            paragraph(c.example) +
            (await visuals(c.id)) +
            '</section>';
        html += await visuals(undefined);
        for (const insight of s.insights)
          html += '<h3>' + esc(insight.title) + '</h3>' + paragraph(insight.text);
        html +=
          '<p class="meta">' +
          esc(s.scopeNote) +
          '</p><section class="review"><h3>复习题</h3>' +
          s.questions
            .map(
              (q, i) =>
                '<details><summary>' +
                (i + 1) +
                '. ' +
                esc(q.prompt) +
                '</summary>' +
                paragraph(q.context) +
                paragraph(q.answer) +
                '</details>',
            )
            .join('') +
          '</section></article>';
      }
      html += '</div></section>';
    }
    document.querySelector('#report').innerHTML = html;
    await document.fonts.ready;
    return { html, errors };
  }, cases);
  await writeFile(
    join(output, 'report.html'),
    `<meta charset="utf-8"><title>总结提示词对照</title><style>${css}</style><main>${result.html}</main>`,
  );
  await writeFile(join(output, 'preview-errors.json'), JSON.stringify(result.errors, null, 2));
  for (const item of cases)
    await page.locator('#' + item.id).screenshot({ path: join(output, item.id, 'comparison.png') });
  for (const figure of await page.locator('[data-figure]').all())
    await figure.screenshot({ path: join(output, (await figure.getAttribute('data-figure')) + '.png') });
  console.log(
    JSON.stringify({ report: join(output, 'report.html'), cases: cases.length, errors: result.errors }),
  );
} finally {
  await browser.close();
}
