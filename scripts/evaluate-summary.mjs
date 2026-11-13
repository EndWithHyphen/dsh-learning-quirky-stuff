import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { buildSummaryPrompt } from '../model.js';
import { SUMMARY_PROMPT_VERSION } from '../summary-prompt.js';
import { runCodex } from '../codex-provider.js';
import { STUDY_SCHEMA, parseStudy, studyText } from '../study-schema.js';
import { validateShape } from '../server/ai/gateway.js';
import { summaryEvaluationCases } from '../tests/summary-evaluation-fixture.mjs';

// Opt-in real model evaluation. Results stay under ignored dist/ and never enter the note store.
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: 'dist/summary-evaluation' },
    baseline: { type: 'string' },
    snapshot: { type: 'boolean', default: false },
    model: { type: 'string', default: 'gpt-6-astra' },
    effort: { type: 'string', default: 'max' },
    phase: { type: 'string' },
    case: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
  },
});
if (values.phase && !['development', 'holdout'].includes(values.phase)) throw new Error('Unknown phase');
if (values.case && !summaryEvaluationCases.some((item) => item.id === values.case))
  throw new Error('Unknown evaluation case');
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
  throw new Error('Concurrency must be between 1 and 4');
const cancellation = new AbortController();
for (const event of ['SIGINT', 'SIGTERM'])
  process.once(event, () => cancellation.abort(new Error('Evaluation stopped')));
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const fixtures = summaryEvaluationCases.filter(
  (item) => (!values.phase || item.phase === values.phase) && (!values.case || item.id === values.case),
);
const runLabel = values.case || values.phase || 'all';
const jobs = [];
for (const item of fixtures) {
  const dir = join(output, item.id);
  await mkdir(dir, { recursive: true });
  const elements = [{ id: 'text-' + item.id, type: 'text', text: item.text, x: 0, y: 0 }];
  const images = [];
  if (item.svg) {
    let png;
    try {
      png = await readFile(join(dir, 'source.png'));
    } catch {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 1 });
        await page.setContent('<style>body{margin:0}</style>' + item.svg);
        await page.evaluate(() => document.fonts.ready);
        png = await page.screenshot();
      } finally {
        await browser.close();
      }
      await writeFile(join(dir, 'source.png'), png);
    }
    images.push({ mimeType: 'image/png', data: png.toString('base64') });
    elements.push({
      id: 'image-' + item.id,
      type: 'image',
      fileId: 'image-file',
      x: 0,
      y: 600,
      width: 1100,
      height: 620,
    });
  }
  const prompt = buildSummaryPrompt(
    { title: item.title, summaries: [] },
    { elements, images, scope: 'board', infographics: true },
  );
  await writeFile(join(dir, 'prompt.txt'), prompt);
  await writeFile(join(dir, 'review.json'), JSON.stringify(item.review, null, 2));
  if (!values.snapshot) {
    if (values.baseline) {
      const baselinePrompt = await readFile(join(resolve(values.baseline), item.id, 'prompt.txt'), 'utf8');
      jobs.push({ id: item.id, dir, variant: 'baseline', prompt: baselinePrompt, images });
    }
    jobs.push({ id: item.id, dir, variant: 'candidate', prompt, images });
  }
}
await writeFile(
  join(output, 'run-' + runLabel + '.json'),
  JSON.stringify(
    {
      promptVersion: SUMMARY_PROMPT_VERSION,
      model: values.model,
      effort: values.effort,
      baseline: values.baseline ? resolve(values.baseline) : null,
      cases: fixtures.map(({ id, phase }) => ({ id, phase })),
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
let index = 0;
const results = [];
async function worker() {
  while (index < jobs.length && !cancellation.signal.aborted) {
    const job = jobs[index++],
      file = join(job.dir, job.variant + '.json');
    const inputHash = hash(
      JSON.stringify({ prompt: job.prompt, images: job.images, model: values.model, effort: values.effort }),
    );
    try {
      const previous = JSON.parse(await readFile(file, 'utf8'));
      if (previous.inputHash === inputHash && previous.ok) {
        results.push(previous);
        console.log('REUSE', job.id, job.variant);
        continue;
      }
    } catch {}
    const start = Date.now();
    console.log('START', job.id, job.variant);
    let result;
    try {
      const raw = await runCodex({
        prompt: job.prompt,
        schema: STUDY_SCHEMA,
        images: job.images,
        model: values.model,
        reasoningEffort: values.effort,
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(30 * 60 * 1000)]),
      });
      const value = validateShape(JSON.parse(raw), STUDY_SCHEMA);
      const study = parseStudy(value),
        markdown = studyText(study);
      const body = [
        study.overview,
        ...study.takeaways,
        ...study.concepts.flatMap((c) => [c.explanation, c.example]),
        ...study.insights.map((x) => x.text),
      ].join('');
      result = {
        id: job.id,
        variant: job.variant,
        ok: true,
        inputHash,
        elapsedMs: Date.now() - start,
        model: values.model,
        effort: values.effort,
        counts: {
          bodyCharacters: [...body].length,
          sections: study.concepts.length,
          questions: study.questions.length,
          diagrams: study.diagrams.length,
          sourceFigures: study.sourceFigures.length,
          infographics: study.infographics.length,
        },
        value,
        study,
      };
      await writeFile(join(job.dir, job.variant + '.md'), markdown);
    } catch (error) {
      result = {
        id: job.id,
        variant: job.variant,
        ok: false,
        inputHash,
        elapsedMs: Date.now() - start,
        error: error.message,
      };
    }
    await writeFile(file, JSON.stringify(result, null, 2));
    results.push(result);
    console.log(
      result.ok ? 'DONE' : 'FAIL',
      job.id,
      job.variant,
      JSON.stringify(result.ok ? result.counts : result.error),
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (!values.snapshot) {
  await writeFile(
    join(output, 'metrics-' + runLabel + '.json'),
    JSON.stringify(
      results.map(({ value, study, ...r }) => r),
      null,
      2,
    ),
  );
  if (results.some((r) => !r.ok) || cancellation.signal.aborted) process.exitCode = 1;
}
console.log(values.snapshot ? 'SNAPSHOT' : 'RESULTS', output);
