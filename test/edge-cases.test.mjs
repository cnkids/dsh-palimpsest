// 边界用例：补上默认参数、缺失输入与降级分支的行为。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSessionHits } from '../lib/core/scan.js';
import { snippetAround } from '../lib/core/snippet.js';
import { currentCwd, currentSessionId } from '../lib/tools/context.js';
import { OUTPUT } from '../lib/tools/output.js';

test('rankSessionHits 不传上限时返回全部', () => {
  const entries = [{ lastTime: 1 }, { lastTime: 2 }];
  assert.equal(rankSessionHits(entries).length, 2);
  assert.equal(rankSessionHits(entries, 0).length, 2);
});

test('rankSessionHits 对缺失时间按 0 处理', () => {
  const ranked = rankSessionHits([{ id: 'missing' }, { id: 'dated', lastTime: 5 }], 2);
  assert.deepEqual(ranked.map((entry) => entry.id), ['dated', 'missing']);
});

test('snippetAround 的上限非法时使用默认值', () => {
  const long = 'a'.repeat(500);
  assert.equal(snippetAround(long, 'a', undefined).length, 201);
  assert.equal(snippetAround(long, 'a', -5).length, 201);
});

test('片段定位与 DSH 一致：空白灵活、大小写不敏感', () => {
  const text = `${'前'.repeat(80)} foo   bar ${'后'.repeat(80)}`;
  // 查询用两个空格，正文用三个空格：DSH 的字面过滤能命中，片段也必须能定位到
  const out = snippetAround(text, 'foo  bar', 30);
  assert.match(out, /foo\s+bar/u);
  assert.match(snippetAround(text, 'FOO BAR', 30), /foo\s+bar/iu);
});

test('查询里的正则元字符按字面处理', () => {
  const text = `${'前'.repeat(80)} a.b*c ${'后'.repeat(80)}`;
  assert.match(snippetAround(text, 'a.b*c', 30), /a\.b\*c/u);
});

test('currentCwd 优先使用调用方会话的工作目录', () => {
  const exec = { agent: { session: { header: { cwd: '/from/session/' } } } };
  assert.equal(currentCwd(exec), '/from/session');
});

test('currentCwd 在缺少调用方会话时返回空串而不猜进程目录', () => {
  // 回退到 process.cwd() 会把范围放大到 dsh 服务的启动目录，必须失败关闭
  assert.equal(currentCwd(undefined), '');
  assert.equal(currentCwd({}), '');
  assert.equal(currentCwd({ agent: { session: { header: {} } } }), '');
});

test('currentSessionId 取调用方会话 id', () => {
  const exec = { agent: { session: { header: { id: 'session-a' } } } };
  assert.equal(currentSessionId(exec), 'session-a');
});

test('currentSessionId 取不到时返回 undefined，不会误排除', () => {
  assert.equal(currentSessionId(undefined), undefined);
  assert.equal(currentSessionId({}), undefined);
  assert.equal(currentSessionId({ agent: { session: { header: { id: '' } } } }), undefined);
  assert.equal(currentSessionId({ agent: { session: { header: { id: 42 } } } }), undefined);
});

test('rankSessionHits 命中数多者在前', () => {
  const ranked = rankSessionHits(
    [
      { id: 'few', matchCount: 1, lastTime: 100 },
      { id: 'many', matchCount: 4, lastTime: 1 },
    ],
    2,
  );
  assert.deepEqual(ranked.map((entry) => entry.id), ['many', 'few']);
});

test('rankSessionHits 命中数缺失时退化为按时间排序', () => {
  const ranked = rankSessionHits([{ id: 'old', lastTime: 1 }, { id: 'new', lastTime: 9 }], 2);
  assert.deepEqual(ranked.map((entry) => entry.id), ['new', 'old']);
});

test('OUTPUT.render 把 content 渲染为文本块', () => {
  assert.deepEqual(OUTPUT.render({}, { content: '正文' }), [{ type: 'text', text: '正文' }]);
});

test('OUTPUT.render 对缺失值给出空串而不是 undefined', () => {
  assert.deepEqual(OUTPUT.render({}, undefined), [{ type: 'text', text: '' }]);
});
