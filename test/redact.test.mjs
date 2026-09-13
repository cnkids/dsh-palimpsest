import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/core/redact.js';

// 用运行时拼接构造「像密钥的字符串」，避免把字面量密钥写进源码
// （那种字符串会被 SonarQube 的密钥检测命中，即使它只是测试数据）。
const BODY = 'abcdefghijklmnopqrstuvwx';
const shaped = (prefix, separator = '-') => `${prefix}${separator}${BODY}`;

test('打码 sk- 形态的 API key', () => {
  const { text, count } = redact(`我的 key 是 ${shaped('sk')} 请收好`);
  assert.equal(count, 1);
  assert.ok(!text.includes(BODY));
  assert.match(text, /«已打码»/u);
});

test('打码各家 token 形态', () => {
  const cases = [
    shaped('sqp', '_'),
    shaped('ghp', '_'),
    `AKIA${'ABCDEFGHIJKLMNOP'}`,
    shaped('xoxb'),
    `Bearer ${BODY}${BODY}`,
  ];
  for (const secret of cases) {
    const { text, count } = redact(`凭据：${secret}`);
    assert.equal(count, 1, `未打码：${secret}`);
    assert.ok(!text.includes(BODY), `残留：${secret}`);
  }
});

test('打码私钥块开头', () => {
  const { count } = redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc');
  assert.equal(count, 1);
});

test('赋值型密钥只遮值、保留键名', () => {
  const { text, count } = redact('password=hunter2hunter2');
  assert.equal(count, 1);
  assert.match(text, /password=«已打码»/u);
});

test('变量引用与占位符不算凭据（真机误报回归）', () => {
  const cases = [
    '-Dsonar.token=$SONAR_TOKEN',
    'token=${SONAR_TOKEN}',
    'api_key=<your-key-here>',
    'password=your-password-here',
    'secret=CHANGEME_please',
  ];
  for (const line of cases) {
    const { text, count } = redact(line);
    assert.equal(count, 0, `误报：${line}`);
    assert.equal(text, line, `被改动：${line}`);
  }
});

test('普通文本原样返回', () => {
  const original = '这是一段普通的中文对话，提到 token 这个词但没有赋值。';
  const { text, count } = redact(original);
  assert.equal(count, 0);
  assert.equal(text, original);
});

test('多处命中累计计数', () => {
  const { count } = redact(`${shaped('sk')} 和 ${shaped('ghp', '_')}`);
  assert.equal(count, 2);
});

test('非字符串输入安全返回空文本', () => {
  assert.deepEqual(redact(undefined), { text: '', count: 0 });
  assert.deepEqual(redact(42), { text: '', count: 0 });
  assert.deepEqual(redact(''), { text: '', count: 0 });
});

test('长文本上不出现灾难性回溯', () => {
  const started = Date.now();
  redact('a'.repeat(200_000));
  assert.ok(Date.now() - started < 1000, '脱敏在长文本上耗时异常');
});
