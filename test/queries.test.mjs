import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSessionsForCwd, transcriptOf, attachTitles, safe } from '../lib/queries.js';
import { fakeSessionQuery, record, userEvent, HOUR } from './helpers.mjs';

test('safe 吞掉异常并返回兜底值', async () => {
  assert.equal(await safe(() => Promise.reject(new Error('x')), 'fallback'), 'fallback');
  assert.equal(await safe(() => Promise.resolve(1), 0), 1);
});

test('只列出同一工作目录的会话', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a', { cwd: '/work' }), record('b', { cwd: '/other' })],
  });
  const { entries } = await listSessionsForCwd(query, { cwd: '/work', limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.id), ['a']);
});

test('默认排除子代理会话，开关可放开', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('top'), record('child', { depth: 1 })],
  });
  const { entries: scoped } = await listSessionsForCwd(query, { cwd: '/work', limit: 10 });
  assert.deepEqual(scoped.map((entry) => entry.id), ['top']);
  const { entries: all } = await listSessionsForCwd(query, { cwd: '/work', limit: 10, includeSubagents: true });
  assert.deepEqual(all.map((entry) => entry.id), ['top', 'child']);
});

test('按最后活跃时间倒序并应用上限', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('old', { createdAt: 1 }), record('new', { createdAt: 2 })],
    listEvents: async (id) => (id === 'old' ? [userEvent(1, 5 * HOUR, 'x')] : [userEvent(1, 9 * HOUR, 'y')]),
  });
  const { entries } = await listSessionsForCwd(query, { cwd: '/work', limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.id), ['new', 'old']);
  assert.equal(entries[0].lastTime, 9 * HOUR);
});

test('limit 只保留最近的若干条', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a', { createdAt: 1 }), record('b', { createdAt: 2 })],
    listEvents: async (id) => [userEvent(1, id === 'b' ? 9 * HOUR : HOUR, 'x')],
  });
  const { entries } = await listSessionsForCwd(query, { cwd: '/work', limit: 1 });
  assert.deepEqual(entries.map((entry) => entry.id), ['b']);
});

test('统计事件数与用户消息数', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a')],
    listEvents: async () => [userEvent(1, HOUR, 'x'), userEvent(2, 2 * HOUR, 'y'), { type: 'assistant/message', seq: 3, time: 3 * HOUR, data: {} }],
  });
  const { entries: [entry] } = await listSessionsForCwd(query, { cwd: '/work', limit: 1 });
  assert.equal(entry.eventCount, 3);
  assert.equal(entry.userMessages, 2);
  assert.equal(entry.lastTime, 3 * HOUR);
});

test('单个会话读失败时退化为空统计而不整体失败', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a', { createdAt: 7 })],
    listEvents: async () => {
      throw new Error('会话损坏');
    },
  });
  const { entries: [entry] } = await listSessionsForCwd(query, { cwd: '/work', limit: 1 });
  assert.equal(entry.eventCount, 0);
  // 读不出事件时活跃时间是「未知」，不能是 0 —— 否则会渲染成 1970-01-01
  assert.equal(entry.lastTime, undefined);
});

test('标题来自批量快照，且只调一次', async () => {
  let calls = 0;
  const query = fakeSessionQuery({
    listSessions: async () => [record('a'), record('b')],
    readTitleSnapshots: async (ids) => {
      calls += 1;
      return ids.map((sessionId) => ({
        sessionId,
        status: 'fulfilled',
        value: { title: { title: `标题-${sessionId}` } },
      }));
    },
  });
  const { entries } = await listSessionsForCwd(query, { cwd: '/work', limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.title).sort(), ['标题-a', '标题-b']);
  // 逐个会话各调一次 readTitle 会让 DSH 反复列举持久层，必须批量取
  assert.equal(calls, 1);
});

test('候选窗口有界：会话远超 limit 时不会把范围内所有会话都读一遍', async () => {
  const many = Array.from({ length: 200 }, (_, index) => record(`s${index}`, { createdAt: index + 1 }));
  let listEventsCalls = 0;
  const query = fakeSessionQuery({
    listSessions: async () => many,
    listEvents: async () => {
      listEventsCalls += 1;
      return [userEvent(1, HOUR, 'x')];
    },
  });
  const result = await listSessionsForCwd(query, { cwd: '/work', limit: 1 });
  assert.equal(result.entries.length, 1);
  assert.equal(result.total, 200);
  assert.ok(result.inspected < 200, `候选窗口未收敛：${result.inspected}`);
  assert.equal(listEventsCalls, result.inspected);
});

test('attachTitles 补上批量标题', async () => {
  const query = fakeSessionQuery({
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: `标题-${sessionId}` } } })),
  });
  const { entries, unreadable } = await attachTitles(query, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(entries.map((entry) => entry.title), ['标题-a', '标题-b']);
  assert.equal(unreadable, 0);
});

test('attachTitles 剔除标题读不出来的条目并回报数量（失败关闭，安全审计 F1）', async () => {
  // 早期实现「保留原值」：原值可能是空串，而空标题会让 hidePrivate 把私密会话放行
  const perItem = fakeSessionQuery({
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId, index) =>
        index === 0 ? { sessionId, status: 'rejected' } : { sessionId, status: 'fulfilled', value: {} },
      ),
  });
  const result = await attachTitles(perItem, [{ id: 'a', title: '原值' }, { id: 'b' }]);
  assert.deepEqual(result.entries.map((entry) => entry.id), ['b']);
  assert.equal(result.unreadable, 1);

  // 整批抛错（宿主持久化列举失败时 projectMany 整批 rejected）→ 全部按不可读处理
  const batch = fakeSessionQuery({
    readTitleSnapshots: async () => {
      throw Object.assign(new Error('列举失败'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' });
    },
  });
  const failed = await attachTitles(batch, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(failed.entries, []);
  assert.equal(failed.unreadable, 2);
});

test('listSessionsForCwd 剔除标题读不出来的会话并回报数量（安全审计 F1）', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('ok', { createdAt: 2 }), record('unknown', { createdAt: 1 })],
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) =>
        sessionId === 'ok'
          ? { sessionId, status: 'fulfilled', value: { title: { title: '正常' } } }
          : { sessionId, status: 'rejected' },
      ),
  });
  const { entries, unreadable } = await listSessionsForCwd(query, { cwd: '/work', limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.id), ['ok']);
  assert.equal(unreadable, 1);
});

test('transcriptOf 把 surface 事件折成对话条目', async () => {
  const query = fakeSessionQuery({
    readSurface: async () => ({ session: { id: 'a', cwd: '/work' }, events: [userEvent(1, HOUR, '你好')] }),
  });
  const { session, items } = await transcriptOf(query, 'a');
  assert.equal(session.cwd, '/work');
  assert.deepEqual(items.map((item) => item.text), ['你好']);
});

test('transcriptOf 容忍缺失的 surface', async () => {
  const query = fakeSessionQuery({ readSurface: async () => undefined });
  const { session, items } = await transcriptOf(query, 'a');
  assert.equal(session, undefined);
  assert.deepEqual(items, []);
});
