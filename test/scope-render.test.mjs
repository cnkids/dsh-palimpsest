import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCwd, matchesCwd } from '../lib/core/scope.js';
import { clampCount, clampHead, clampTail } from '../lib/core/limit.js';
import { snippetAround } from '../lib/core/snippet.js';

test('去掉尾部斜杠', () => {
  assert.equal(normalizeCwd('/a/b/'), '/a/b');
  assert.equal(normalizeCwd('/a/b'), '/a/b');
});

test('根目录保持为斜杠', () => {
  assert.equal(normalizeCwd('/'), '/');
});

test('空白与非法输入返回 undefined', () => {
  assert.equal(normalizeCwd('   '), undefined);
  assert.equal(normalizeCwd(undefined), undefined);
  assert.equal(normalizeCwd(42), undefined);
});

test('同一目录忽略尾部斜杠差异', () => {
  assert.equal(matchesCwd({ cwd: '/a/b/' }, '/a/b'), true);
});

test('不同目录不匹配', () => {
  assert.equal(matchesCwd({ cwd: '/a/b' }, '/a/c'), false);
});

test('会话缺少 cwd 时不匹配任何目录', () => {
  assert.equal(matchesCwd({}, '/a/b'), false);
  assert.equal(matchesCwd(undefined, '/a/b'), false);
});

test('clampCount 使用缺省值与上限', () => {
  assert.equal(clampCount(undefined, 20, 100), 20);
  assert.equal(clampCount(0, 20, 100), 20);
  assert.equal(clampCount(-5, 20, 100), 20);
  assert.equal(clampCount(5, 20, 100), 5);
  assert.equal(clampCount(500, 20, 100), 100);
  assert.equal(clampCount(5.9, 20, 100), 5);
});

test('clampTail 保留尾部并标注省略量', () => {
  const out = clampTail('0123456789', 4);
  assert.match(out, /省略较早的 6 个字符/u);
  assert.ok(out.endsWith('6789'));
});

test('clampTail 在限内不改动文本', () => {
  assert.equal(clampTail('短', 100), '短');
  assert.equal(clampTail('短', 0), '短');
});

test('clampHead 保留头部并提示总量', () => {
  const out = clampHead('0123456789', 4);
  assert.ok(out.startsWith('0123'));
  assert.match(out, /共 10 个字符/u);
});

test('片段短于上限时原样返回', () => {
  assert.equal(snippetAround('很短', '短', 100), '很短');
});

test('片段围绕关键词截取', () => {
  const text = `${'前'.repeat(50)}关键词${'后'.repeat(50)}`;
  const out = snippetAround(text, '关键词', 20);
  assert.match(out, /关键词/u);
  assert.ok(out.startsWith('…'));
  assert.ok(out.endsWith('…'));
});

test('关键词缺失时退化为开头', () => {
  const out = snippetAround('abcdefg', 'zzz', 3);
  assert.equal(out, 'abc…');
});

test('片段压平换行', () => {
  assert.equal(snippetAround('a\n\n  b', 'b', 100), 'a b');
});
