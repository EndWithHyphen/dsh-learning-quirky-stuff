import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfFrameCache } from '../src/pdf/frame-cache.js';
const frame = () => ({ canvas: { width: 100, height: 100 } });

test('PDF 缓存复用相邻页位图，保留当前页并释放超额像素', async () => {
  const cache = new PdfFrameCache({ maxEntries: 3, maxPixels: 25000 });
  let calls = 0;
  const build = async () => {
    calls++;
    return frame();
  };
  const first = await cache.get('page1', build, true),
    next = await cache.get('page2', build);
  assert.equal(await cache.get('page2', build, true), next);
  assert.equal(calls, 2, 'A warm page must not parse or rasterize again');
  await cache.get('page3', build);
  assert.equal(first.canvas.width, 0);
  assert.equal(next.canvas.width, 100);
  assert.equal(cache.entries.size, 2);
  cache.clear();
  assert.equal(next.canvas.width, 0);
});

test('连续快速翻页会取消被淘汰的绘制，迟到的位图立即释放', async () => {
  const cache = new PdfFrameCache({ maxEntries: 1 });
  let finish, oldSignal;
  const old = cache.get(
    'page1',
    (signal) => {
      oldSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const current = await cache.get('page5', async () => frame(), true);
  assert.equal(oldSignal.aborted, true);
  const stale = frame();
  finish(stale);
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(stale.canvas.width, 0);
  assert.equal(cache.entries.size, 1);
  assert.equal(current.canvas.width, 100);
  cache.clear();
});

test('失败绘制可以重试，关闭阅读器会取消尚未开始的预读', async () => {
  const cache = new PdfFrameCache();
  await assert.rejects(
    cache.get(
      'bad',
      async () => {
        throw Error('read failed');
      },
      true,
    ),
    /read failed/,
  );
  assert.equal((await cache.get('bad', async () => frame(), true)).canvas.width, 100);
  let started = false;
  const waiting = cache.get('next', async () => {
    started = true;
    return frame();
  });
  cache.clear();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(started, false);
});
