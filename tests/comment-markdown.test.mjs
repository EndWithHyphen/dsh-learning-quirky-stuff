import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { visibleCommentMessages } from '../shared/canvas-comments.js';

await mkdir('node_modules/.cache', { recursive: true });
const folder = await mkdtemp(join(resolve('node_modules/.cache'), 'comment-markdown-'));
after(() => rm(folder, { recursive: true, force: true }));
await build({
  entryPoints: ['src/comment-markdown.jsx'],
  outfile: join(folder, 'render.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react'],
  logLevel: 'silent',
});
const { default: Markdown } = await import(pathToFileURL(join(folder, 'render.mjs')));
const render = (value) =>
  new JSDOM(renderToStaticMarkup(React.createElement(Markdown, { value }))).window.document;

test('回答渲染 Markdown 重点、段落、列表、引用和表格，兼容模型多余的闭合空格', () => {
  const doc = render(
    '## 核心判断\n\n材料中的**主体**，以及 **需要说明。 **\n\n1. 第一项\n2. 第二项\n\n> 保留适用边界\n\n|概念|说明|\n|---|---|\n|主张|需要证据|',
  );
  assert.equal(doc.querySelector('h4').textContent, '核心判断');
  assert.deepEqual(
    [...doc.querySelectorAll('strong')].map((e) => e.textContent),
    ['主体', '需要说明。'],
  );
  assert.equal(doc.querySelectorAll('ol li').length, 2);
  assert.equal(doc.querySelector('blockquote').textContent, '保留适用边界');
  assert.equal(doc.querySelectorAll('th').length, 2);
  assert.equal(doc.querySelector('td').textContent, '主张');
  assert.ok(!doc.body.textContent.includes('**'));
});
test('Markdown 保留代码原文，不执行 HTML 或脚本链接，不自动加载远程图片', () => {
  const doc = render(
    '`**原样 **`\n\n```js\nconst value = "**原样 **";\n```\n\n<script>alert(1)</script>\n\n<img src="https://example.org/track" onerror="alert(1)">\n\n[不可执行](javascript:alert(1)) [资料](https://example.org/source) ![示意图](https://example.org/track)',
  );
  assert.equal(doc.querySelector('code').textContent, '**原样 **');
  assert.match(doc.querySelector('pre code').textContent, /\*\*原样 \*\*/);
  assert.equal(doc.querySelectorAll('script,img,iframe').length, 0);
  assert.equal(doc.querySelectorAll('a').length, 1);
  assert.equal(doc.querySelector('a').href, 'https://example.org/source');
  assert.equal(doc.querySelector('a').rel, 'noopener noreferrer');
});
test('成功重试替代旧失败展示，兼容已有讨论并区分不同来源的同名问题', () => {
  const failed = {
      id: 'old',
      role: 'question',
      body: '为什么',
      sourceHash: 'one',
      task: { status: 'error' },
    },
    next = { id: 'next', role: 'question', body: '为什么', sourceHash: 'one', task: { status: 'done' } },
    answer = { id: 'answer', role: 'assistant', replyTo: 'next', body: '回答' };
  assert.deepEqual(
    visibleCommentMessages([failed, next, answer]).map((m) => m.id),
    ['next', 'answer'],
  );
  assert.equal(visibleCommentMessages([failed, { ...next, sourceHash: 'two' }, answer]).length, 3);
  assert.deepEqual(
    visibleCommentMessages([failed, { ...next, sourceHash: 'two', retryOf: 'old' }, answer]).map((m) => m.id),
    ['next', 'answer'],
  );
  assert.equal(visibleCommentMessages([failed, { ...next, task: { status: 'running' } }]).length, 2);
  const twice = { ...next, task: { status: 'error' }, retryOf: 'old' },
    third = { ...next, id: 'third', retryOf: 'next' };
  assert.deepEqual(
    visibleCommentMessages([failed, twice, third, { ...answer, replyTo: 'third' }]).map((m) => m.id),
    ['third', 'answer'],
  );
});
