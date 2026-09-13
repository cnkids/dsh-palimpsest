import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSessions } from '../lib/search.js';
import { fakeSessionQuery, record, document, HOUR } from './helpers.mjs';

test('全文索引可用时走索引通道', async () => {
  const query = fakeSessionQuery({
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: '索引标题' } } })),
    searchSessions: async () => ({
      items: [
        {
          header: { id: 'a', cwd: '/work', createdAt: 1 },
          bestMatch: { seq: 4, time: 5 * HOUR, snippet: '索引片段' },
        },
      ],
    }),
  });
  const result = await searchSessions(query, { query: '词', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.equal(result.engine, 'index');
  assert.equal(result.entries[0].id, 'a');
  assert.equal(result.entries[0].title, '索引标题');
  assert.equal(result.entries[0].matches[0].snippet, '索引片段');
});

test('索引未启用时回退到逐会话扫描', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a')],
    filterEvents: async () => [document(4, 5 * HOUR, '命中内容')],
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: '扫描标题' } } })),
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.equal(result.engine, 'scan');
  assert.deepEqual(result.entries.map((entry) => entry.id), ['a']);
  assert.equal(result.entries[0].title, '扫描标题');
  assert.match(result.entries[0].matches[0].snippet, /命中内容/u);
});

test('两条检索通道都补会话标题', async () => {
  const titled = async (ids) =>
    ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: '统一标题' } } }));
  const indexQuery = fakeSessionQuery({
    readTitleSnapshots: titled,
    searchSessions: async () => ({ items: [{ header: { id: 'a', cwd: '/work', createdAt: 1 }, bestMatch: { seq: 1, time: HOUR, snippet: 's' } }] }),
  });
  const scanQuery = fakeSessionQuery({
    readTitleSnapshots: titled,
    listSessions: async () => [record('a')],
    filterEvents: async () => [document(1, HOUR, '命中')],
  });
  const viaIndex = await searchSessions(indexQuery, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  const viaScan = await searchSessions(scanQuery, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.equal(viaIndex.engine, 'index');
  assert.equal(viaScan.engine, 'scan');
  assert.equal(viaIndex.entries[0].title, '统一标题');
  assert.equal(viaScan.entries[0].title, '统一标题');
});

test('扫描忽略其他工作目录的会话', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a', { cwd: '/work' }), record('b', { cwd: '/other' })],
    filterEvents: async () => [document(1, HOUR, '命中')],
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.deepEqual(result.entries.map((entry) => entry.id), ['a']);
});

test('扫描忽略子代理会话', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('child', { depth: 1 })],
    filterEvents: async () => [document(1, HOUR, '命中')],
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.deepEqual(result.entries, []);
});

test('没有命中的会话不出现在结果里', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a')],
    filterEvents: async () => [],
  });
  const result = await searchSessions(query, { query: '无', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.deepEqual(result.entries, []);
});

test('索引抛非禁用错误时同样降级为扫描', async () => {
  const query = fakeSessionQuery({
    searchSessions: async () => {
      throw new Error('索引损坏');
    },
    listSessions: async () => [record('a')],
    filterEvents: async () => [document(1, HOUR, '命中')],
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.equal(result.engine, 'scan');
  assert.equal(result.entries.length, 1);
});

test('命中数相同时按最后命中时间倒序并受 limit 约束', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a', { createdAt: 1 }), record('b', { createdAt: 2 })],
    filterEvents: async (id) => [document(1, id === 'a' ? 9 * HOUR : HOUR, '命中')],
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 1, snippetChars: 100 });
  assert.deepEqual(result.entries.map((entry) => entry.id), ['a']);
});

test('命中处数多者优先于更近但只提一句的会话', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('many', { createdAt: 1 }), record('recent', { createdAt: 2 })],
    filterEvents: async (id) =>
      id === 'many' ? [1, 2, 3, 4].map((seq) => document(seq, HOUR, '命中')) : [document(1, 9 * HOUR, '命中')],
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.deepEqual(result.entries.map((entry) => entry.id), ['many', 'recent']);
  assert.equal(result.entries[0].matchCount, 4);
});

test('排除调用方自身会话', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('current'), record('other')],
    filterEvents: async () => [document(1, HOUR, '命中')],
  });
  const request = { query: '命中', cwd: '/work', limit: 5, snippetChars: 100, excludeSessionId: 'current' };
  const result = await searchSessions(query, request);
  assert.deepEqual(result.entries.map((entry) => entry.id), ['other']);
});

test('索引通道同样排除调用方自身会话', async () => {
  const hit = (id) => ({ header: { id, cwd: '/work', createdAt: 1 }, bestMatch: { seq: 1, time: HOUR, snippet: 's' } });
  const query = fakeSessionQuery({
    searchSessions: async () => ({ items: [hit('current'), hit('other')] }),
  });
  const request = { query: 'x', cwd: '/work', limit: 5, snippetChars: 100, excludeSessionId: 'current' };
  const result = await searchSessions(query, request);
  assert.equal(result.engine, 'index');
  assert.deepEqual(result.entries.map((entry) => entry.id), ['other']);
});

test('单个会话过滤失败时跳过它', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a'), record('b')],
    filterEvents: async (id) => {
      if (id === 'a') throw new Error('会话损坏');
      return [document(1, HOUR, '命中')];
    },
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.deepEqual(result.entries.map((entry) => entry.id), ['b']);
});

test('每个会话只展示三个片段，但记录命中总数', async () => {
  const query = fakeSessionQuery({
    listSessions: async () => [record('a')],
    filterEvents: async () => [1, 2, 3, 4, 5].map((seq) => document(seq, seq * HOUR, `命中${seq}`)),
  });
  const result = await searchSessions(query, { query: '命中', cwd: '/work', limit: 5, snippetChars: 100 });
  assert.equal(result.entries[0].matches.length, 3);
  assert.equal(result.entries[0].matchCount, 5);
});
