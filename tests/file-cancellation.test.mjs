import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { quietFileCancellation } from '../scripts/excalidraw-cancellation.mjs';

test('取消文件选择安静退出；其他异常继续报告，原有清理流程仍执行', () => {
  const cases = [
    'e.name!=="AbortError"?console.error(e):console.warn(e);finished=true;',
    'e?.name!=="AbortError"?console.error(e):console.warn(e);finished=true;',
    'e?.name==="AbortError"?(console.warn(e),false):console.error(e);finished=true;',
    'function handle(e){if(e?.name==="AbortError"){console.warn(e);return}throw e}handle(e);finished=true;',
  ];
  for (const source of cases) {
    const result = quietFileCancellation(source);
    assert.equal(result.guardedAbort, 1);
    const events = [],
      context = {
        e: { name: 'AbortError' },
        finished: false,
        console: { warn: (e) => events.push(e), error: (e) => events.push(e) },
      };
    vm.runInNewContext(result.code, context);
    assert.equal(context.finished, true);
    assert.deepEqual(events, []);
    context.e = { name: 'NotReadableError', message: '真实读取失败' };
    try {
      vm.runInNewContext(result.code, context);
    } catch (e) {
      events.push(e);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0], context.e);
  }
  const unrelated = 'console.warn(new DOMException("读取失败", "NotReadableError"));';
  assert.equal(quietFileCancellation(unrelated).code, unrelated);
});

test('当前 Excalidraw 的取消入口均被限定匹配，依赖升级时可发现变化', async () => {
  const folder = new URL('../node_modules/@excalidraw/excalidraw/dist/prod/', import.meta.url);
  let messages = 0,
    branches = 0;
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.js')) continue;
    const result = quietFileCancellation(await readFile(new URL(name, folder), 'utf8'));
    messages += result.cancelledMessage;
    branches += result.guardedAbort;
  }
  assert.equal(messages, 1);
  assert.equal(branches, 6);
});
