import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, renderItem, renderTranscript, renderForward, renderSessionList, renderHitList } from '../lib/core/render.js';

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();

test('时间格式化为本地 YYYY-MM-DD HH:mm', () => {
  assert.equal(formatTime(at(2026, 1, 2, 3, 4)), '2026-01-02 03:04');
});

test('非法时间戳返回占位文本', () => {
  assert.equal(formatTime(undefined), '时间未知');
  assert.equal(formatTime(Number.NaN), '时间未知');
});

test('对话条目渲染出角色、序号与时间', () => {
  const line = renderItem({ seq: 3, time: at(2026, 1, 2, 3, 4), role: 'user', text: '你好' });
  assert.equal(line, '[用户 #3 2026-01-02 03:04]\n你好');
});

test('未知角色回落为角色原值', () => {
  assert.match(renderItem({ seq: 1, time: 0, role: 'other', text: 'x' }), /^\[other #1/u);
});

test('对话正文包含头部说明', () => {
  const out = renderTranscript([{ seq: 1, time: 0, role: 'user', text: '你好' }], { heading: '抬头' });
  assert.ok(out.startsWith('抬头\n\n'));
});

test('对话超长时保留最近的尾部', () => {
  const items = [
    { seq: 1, time: 0, role: 'user', text: 'A'.repeat(200) },
    { seq: 2, time: 0, role: 'user', text: 'B'.repeat(200) },
  ];
  const out = renderTranscript(items, { maxChars: 100 });
  assert.match(out, /已省略较早/u);
  assert.ok(out.includes('B'));
  assert.ok(!out.includes('A'));
});

test('会话列表带序号、标题与统计', () => {
  const out = renderSessionList([
    { id: 'session-1', title: '标题一', lastTime: at(2026, 1, 2, 3, 4), eventCount: 12, userMessages: 3 },
  ]);
  assert.match(out, /1\. session-1 {2}「标题一」/u);
  assert.match(out, /最后活跃 2026-01-02 03:04 · 事件 12 · 用户消息 3/u);
});

test('无标题会话显示占位', () => {
  assert.match(renderSessionList([{ id: 'session-1', lastTime: 0 }]), /（无标题）/u);
});

test('缺少统计项时不显示零值', () => {
  const out = renderSessionList([{ id: 'session-1', lastTime: 0 }]);
  assert.ok(!out.includes('事件'));
  assert.ok(!out.includes('用户消息'));
});

test('搜索命中渲染出片段', () => {
  const out = renderHitList([
    {
      id: 'session-1',
      title: '标题一',
      lastTime: 0,
      matches: [{ seq: 9, time: at(2026, 1, 2, 3, 4), snippet: '…关键词…' }],
    },
  ]);
  assert.match(out, /· #9 2026-01-02 03:04 …关键词…/u);
});

test('列表标「最后活跃」，命中标「最近命中」', () => {
  const entry = { id: 'session-1', lastTime: 0, matches: [{ seq: 1, time: 0, snippet: 's' }] };
  // 命中通道只掌握「命中时间」，标成「最后活跃」会骗模型
  assert.match(renderSessionList([entry]), /最后活跃/u);
  const hits = renderHitList([entry]);
  assert.match(hits, /最近命中/u);
  assert.ok(!hits.includes('最后活跃'));
});

test('空列表渲染为空串而不是崩溃', () => {
  assert.equal(renderSessionList([], { heading: '' }), '');
  assert.equal(renderHitList([]), '');
});

test('有命中总数时渲染出「命中 N 处」', () => {
  const out = renderHitList([{ id: 'session-1', lastTime: 0, matchCount: 7, matches: [] }]);
  assert.match(out, /命中 7 处/u);
});

test('没有命中总数时不渲染该字段', () => {
  const out = renderHitList([{ id: 'session-1', lastTime: 0, matches: [] }]);
  // 别用 includes('命中')：时间标签「最近命中」本身就含这两个字
  assert.ok(!/命中 \d+ 处/u.test(out));
});

test('renderForward 保留头部并给出下一段起点', () => {
  const items = [1, 2, 3].map((seq) => ({ seq, time: 0, role: 'user', text: String(seq).repeat(50) }));
  const out = renderForward(items, { heading: 'H', maxChars: 120 });
  assert.ok(out.includes('11111'), '应当保留头部内容');
  assert.ok(!out.includes('33333'), '不该跳到尾部');
  // 续读起点是第一条没装下的条目，不是被包含的最后一条
  assert.match(out, /下一段用 fromSeq=2 继续/u);
});

test('renderForward 未超限时不加续读提示', () => {
  const out = renderForward([{ seq: 1, time: 0, role: 'user', text: '短' }], { heading: 'H', maxChars: 500 });
  assert.ok(!out.includes('下一段'));
});

test('renderForward 在上限非法时使用默认值而不是崩掉', () => {
  const out = renderForward([{ seq: 1, time: 0, role: 'user', text: '短' }], { heading: '', maxChars: undefined });
  assert.match(out, /短/u);
});

test('renderForward 连一条都装不下时仍给出被截断的内容与前进游标', () => {
  const items = [
    { seq: 900, time: 0, role: 'user', text: 'X'.repeat(5000) },
    { seq: 901, time: 0, role: 'user', text: 'Y' },
  ];
  const out = renderForward(items, { heading: '抬头', maxChars: 600 });
  assert.match(out, /X{50}/u, '不该返回零字符正文');
  assert.match(out, /下一段用 fromSeq=901 继续/u);
});
