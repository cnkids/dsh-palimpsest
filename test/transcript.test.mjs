import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTranscript } from '../lib/core/transcript.js';
import { messageOf, roleOf } from '../lib/core/messages.js';

const userEvent = (seq, text) => ({
  type: 'user/message',
  seq,
  time: 1000 + seq,
  data: { role: 'user', content: [{ type: 'text', text }] },
});

const assistantEvent = (seq, text) => ({
  type: 'assistant/message',
  seq,
  time: 1000 + seq,
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
});

const toolEvent = (seq, text) => ({
  type: 'tool/result',
  seq,
  time: 1000 + seq,
  data: { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', content: [{ type: 'text', text }] }] } },
});

const systemEvent = (seq, text) => ({
  type: 'system/message',
  seq,
  time: 1000 + seq,
  data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text }] } },
});

test('四种消息事件都映射到对应角色', () => {
  const items = toTranscript([
    systemEvent(0, '系统提示'),
    userEvent(1, '你好'),
    assistantEvent(2, '在的'),
    toolEvent(3, '命令输出'),
  ]);
  assert.deepEqual(
    items.map((item) => item.role),
    ['system', 'user', 'assistant', 'tool'],
  );
});

test('条目保留序号与时间', () => {
  const [item] = toTranscript([userEvent(7, '你好')]);
  assert.equal(item.seq, 7);
  assert.equal(item.time, 1007);
});

test('无文本事件被丢弃，纯工具轨迹带标记', () => {
  const items = toTranscript([
    { type: 'turn/start', seq: 1, time: 1, data: {} },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'tool-call', name: 'x' }] } } },
    { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [] } } },
    userEvent(4, '留下我'),
  ]);
  assert.deepEqual(items.map((item) => item.seq), [2, 4]);
  assert.equal(items[0].toolOnly, true);
  assert.equal(items[1].toolOnly, false);
});

test('非数组输入返回空列表', () => {
  assert.deepEqual(toTranscript(undefined), []);
});

test('roleOf 只认消息事件', () => {
  assert.equal(roleOf('user/message'), 'user');
  assert.equal(roleOf('turn/start'), '');
});

test('messageOf 抹平两种事件形状', () => {
  const direct = { data: { content: [{ type: 'text', text: 'a' }] } };
  const wrapped = { data: { message: { content: [{ type: 'text', text: 'b' }] } } };
  assert.equal(messageOf(direct).content[0].text, 'a');
  assert.equal(messageOf(wrapped).content[0].text, 'b');
  assert.equal(messageOf({ data: {} }), undefined);
  assert.equal(messageOf(undefined), undefined);
});
