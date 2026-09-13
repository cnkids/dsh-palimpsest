import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateTitle, hidePrivate, preface, PRIVATE_MARKERS, UNTRUSTED_NOTICE } from '../lib/core/privacy.js';

test('带私密标记的标题被识别', () => {
  assert.equal(isPrivateTitle('[私密] 那次事故复盘'), true);
  assert.equal(isPrivateTitle('复盘 [NO-RECALL]'), true);
  assert.equal(isPrivateTitle('含 [不参与回忆] 的标题'), true);
});

test('普通标题不被误判', () => {
  assert.equal(isPrivateTitle('移动端浏览器兼容性探讨'), false);
  assert.equal(isPrivateTitle('[公开] 正常标题'), false);
});

test('空标题与非法输入不算私密', () => {
  assert.equal(isPrivateTitle(undefined), false);
  assert.equal(isPrivateTitle(''), false);
  assert.equal(isPrivateTitle(42), false);
});

test('标记表里每一项都能被识别', () => {
  for (const marker of PRIVATE_MARKERS) {
    assert.equal(isPrivateTitle(`前缀 ${marker} 后缀`), true, marker);
  }
});

test('hidePrivate 剔除私密会话并回报数量', () => {
  const entries = [{ id: 'a', title: '正常' }, { id: 'b', title: '[私密] 别读我' }, { id: 'c' }];
  const { visible, hidden } = hidePrivate(entries);
  assert.deepEqual(visible.map((entry) => entry.id), ['a', 'c']);
  assert.equal(hidden, 1);
});

test('没有私密会话时不动结果', () => {
  const { visible, hidden } = hidePrivate([{ id: 'a', title: '正常' }]);
  assert.equal(visible.length, 1);
  assert.equal(hidden, 0);
});

test('前言始终包含不可信数据声明', () => {
  assert.match(preface(0, 0), /不可信的历史数据/u);
  assert.ok(preface(0, 0).includes(UNTRUSTED_NOTICE));
});

test('打码与隐藏都如实写进前言', () => {
  const text = preface(3, 2);
  assert.match(text, /3 处疑似凭据已打码/u);
  assert.match(text, /2 个会话带私密标记/u);
});

test('没有命中时不写多余的话', () => {
  const text = preface(0, 0);
  assert.ok(!text.includes('打码'));
  assert.ok(!text.includes('私密标记'));
});
