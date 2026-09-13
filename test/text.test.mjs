import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksToText } from '../lib/core/text.js';

test('拼接文本块并保序', () => {
  const text = blocksToText([{ type: 'text', text: '第一行' }, { type: 'text', text: '第二行' }]);
  assert.equal(text, '第一行\n第二行');
});

test('推理块与文本块一同取出', () => {
  const text = blocksToText([{ type: 'reasoning', text: '想一想' }, { type: 'text', text: '结论' }]);
  assert.equal(text, '想一想\n结论');
});

test('工具调用压成一行占位', () => {
  assert.equal(blocksToText([{ type: 'tool-call', name: 'read' }]), '[调用 read]');
});

test('工具调用缺名字时仍可读', () => {
  assert.equal(blocksToText([{ type: 'tool-call' }]), '[调用 未知工具]');
});

test('工具结果块递归取文本', () => {
  const block = { type: 'tool-result', content: [{ type: 'text', text: '结果正文' }] };
  assert.equal(blocksToText([block]), '结果正文');
});

test('图片与文件块只留占位符', () => {
  const blocks = [{ type: 'image', attachment: {} }, { type: 'file', attachment: {} }];
  assert.equal(blocksToText(blocks), '[图片]\n[文件]');
});

test('未知块类型被忽略而不是崩溃', () => {
  assert.equal(blocksToText([{ type: 'mystery' }, { type: 'text', text: '留下' }]), '留下');
});

test('非数组与空块输入返回空串', () => {
  assert.equal(blocksToText(undefined), '');
  assert.equal(blocksToText([null, 'x', { type: 'text', text: '' }]), '');
  assert.equal(blocksToText([{ type: 'text', text: 42 }]), '');
});
