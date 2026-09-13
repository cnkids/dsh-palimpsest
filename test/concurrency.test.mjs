import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../lib/core/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('结果保持输入顺序，与完成先后无关', async () => {
  const out = await mapWithConcurrency([30, 5, 15], 3, async (item) => {
    await sleep(item);
    return item * 2;
  });
  assert.deepEqual(out, [60, 10, 30]);
});

test('并发度不超过上限且确实并行', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, index) => index);
  await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await sleep(1);
    inFlight -= 1;
    return item;
  });
  assert.equal(peak, 3);
});

test('把下标作为第二个参数传入', async () => {
  const out = await mapWithConcurrency(['a', 'b'], 1, (item, index) => `${index}:${item}`);
  assert.deepEqual(out, ['0:a', '1:b']);
});

test('空数组不做任何调用', async () => {
  let calls = 0;
  const out = await mapWithConcurrency([], 4, async () => {
    calls += 1;
  });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test('非法并发度退回串行执行', async () => {
  const out = await mapWithConcurrency([1, 2], 0, async (item) => item);
  assert.deepEqual(out, [1, 2]);
  const fallback = await mapWithConcurrency([1, 2], undefined, async (item) => item);
  assert.deepEqual(fallback, [1, 2]);
});

test('处理函数抛错时整体失败', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1], 2, async () => {
      throw new Error('boom');
    }),
    /boom/u,
  );
});
