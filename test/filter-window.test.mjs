import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectMessages } from '../lib/core/filter.js';
import { sliceMessages } from '../lib/core/window.js';

const items = [
  { seq: 1, role: 'system', text: 's' },
  { seq: 2, role: 'user', text: 'u1' },
  { seq: 3, role: 'assistant', text: 'a1' },
  { seq: 4, role: 'tool', text: 't1' },
  { seq: 5, role: 'user', text: 'u2' },
];

test('默认挡掉系统提示与工具结果', () => {
  assert.deepEqual(selectMessages(items).map((item) => item.seq), [2, 3, 5]);
});

test('开关可以把工具结果放回来', () => {
  assert.deepEqual(selectMessages(items, { includeTools: true }).map((item) => item.seq), [2, 3, 4, 5]);
});

test('开关可以把系统提示放回来', () => {
  assert.deepEqual(selectMessages(items, { includeSystem: true }).map((item) => item.seq), [1, 2, 3, 5]);
});

test('不传选项时使用安全默认值', () => {
  assert.deepEqual(selectMessages(items, undefined).map((item) => item.seq), [2, 3, 5]);
});

test('纯工具轨迹默认被挡掉，开关可放开', () => {
  const withToolTrail = [...items, { seq: 6, role: 'assistant', text: '[调用 read]', toolOnly: true }];
  assert.deepEqual(selectMessages(withToolTrail).map((item) => item.seq), [2, 3, 5]);
  assert.deepEqual(
    selectMessages(withToolTrail, { includeTools: true }).map((item) => item.seq),
    [2, 3, 4, 5, 6],
  );
});

test('取最后 N 条', () => {
  assert.deepEqual(sliceMessages(items, { last: 2 }).map((item) => item.seq), [4, 5]);
});

test('last 为非正数时不限条数', () => {
  assert.equal(sliceMessages(items, { last: 0 }).length, 5);
});

test('从 fromSeq 起读到末尾', () => {
  assert.deepEqual(sliceMessages(items, { fromSeq: 3 }).map((item) => item.seq), [3, 4, 5]);
});

test('fromSeq 超出范围时退化为空列表', () => {
  assert.deepEqual(sliceMessages(items, { fromSeq: 99 }), []);
});

test('fromSeq 命中不存在的序号时取其后一条', () => {
  assert.deepEqual(sliceMessages(items, { fromSeq: 4 }).map((item) => item.seq), [4, 5]);
});

test('fromSeq 与 last 可以组合', () => {
  assert.deepEqual(sliceMessages(items, { fromSeq: 2, last: 1 }).map((item) => item.seq), [5]);
});
