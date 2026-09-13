// 冒烟测试：插件入口契约 + 三个工具在真实 defineTool 校验下的端到端输出。
// 数据来源用替身 sessionQuery，因此不依赖 DSH 运行时。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, name, inject } from '../lib/index.js';
import { fakeSessionQuery, record, userEvent, HOUR } from './helpers.mjs';

/** 假的工具注册表，记录注册进来的定义。 */
function fakeTools() {
  const registered = [];
  return {
    registered,
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  };
}

/** 造一个调用现场：会话工作目录为 `/work`。 */
function callContext(cwd = '/work') {
  return { agent: { session: { header: { cwd } } } };
}

/** 装载插件并返回按名字索引的工具表。 */
function loadPlugin(sessionQuery) {
  const tools = fakeTools();
  apply({ tools, sessionQuery });
  return new Map(tools.registered.map((tool) => [tool.name, tool]));
}

test('插件导出契约', () => {
  assert.equal(name, 'palimpsest');
  assert.deepEqual(inject, ['tools', 'sessionQuery']);
});

test('apply 注册三个记忆工具', () => {
  const tools = loadPlugin(fakeSessionQuery());
  assert.deepEqual([...tools.keys()].sort(), ['palimpsest_list', 'palimpsest_read', 'palimpsest_search']);
});

test('每个工具都有描述、对象参数与输出 schema', () => {
  for (const tool of loadPlugin(fakeSessionQuery()).values()) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 20, `${tool.name} 描述过短`);
    assert.equal(tool.parameters.type, 'object');
    assert.ok(tool.output?.schema);
    assert.equal(typeof tool.execute, 'function');
  }
});

test('palimpsest_read 把 sessionId 标记为必填', () => {
  const read = loadPlugin(fakeSessionQuery()).get('palimpsest_read');
  assert.ok(read.parameters.required.includes('sessionId'));
});

test('palimpsest_search 把 query 标记为必填', () => {
  const search = loadPlugin(fakeSessionQuery()).get('palimpsest_search');
  assert.ok(search.parameters.required.includes('query'));
});

test('palimpsest_list 只列出当前工作目录的会话', async () => {
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => [
      record('session-a', { cwd: '/work', createdAt: 1 }),
      record('session-b', { cwd: '/elsewhere', createdAt: 2 }),
    ],
    listEvents: async () => [userEvent(1, 5 * HOUR, '上次的结论')],
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: '跨会话记忆' } } })),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_list').execute({}, callContext());
  assert.match(out.content, /session-a/u);
  assert.ok(!out.content.includes('session-b'));
  assert.match(out.content, /跨会话记忆/u);
});

test('palimpsest_list 候选被截断时如实说明，不谎称已看全', async () => {
  const many = Array.from({ length: 150 }, (_, index) => record(`s${index}`, { cwd: '/work', createdAt: index + 1 }));
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => many,
    listEvents: async () => [userEvent(1, HOUR, 'x')],
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_list').execute({ limit: 2 }, callContext());
  assert.match(out.content, /仅按最近创建检查了 \d+ 个会话（范围内共 150 个）/u);
});

test('palimpsest_search 索引调用失败时说明是失败，不说成「未启用」', async () => {
  const sessionQuery = fakeSessionQuery({
    searchSessions: async () => {
      const error = new Error('索引写入失败');
      error.code = 'SESSION_QUERY_PERSISTENCE_FAILED';
      throw error;
    },
    listSessions: async () => [],
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_search').execute({ query: 'x' }, callContext());
  assert.match(out.content, /SESSION_QUERY_PERSISTENCE_FAILED/u);
  assert.match(out.content, /索引调用失败/u);
  assert.ok(!out.content.includes('全文索引未启用'));
});

test('palimpsest_search 扫描被截断时如实说明', async () => {
  const many = Array.from({ length: 60 }, (_, index) => record(`s${index}`, { cwd: '/work', createdAt: index + 1 }));
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => many,
    filterEvents: async () => [],
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_search').execute({ query: 'x' }, callContext());
  assert.match(out.content, /仅扫描了最近创建的 40 个会话（范围内共 60 个）/u);
});

test('取消信号已发出时不启动重活，直接抛出', async () => {
  const sessionQuery = fakeSessionQuery({ listSessions: async () => [record('a')] });
  const controller = new AbortController();
  controller.abort();
  const exec = { ...callContext(), signal: controller.signal };
  await assert.rejects(
    () => loadPlugin(sessionQuery).get('palimpsest_list').execute({}, exec),
    (error) => error?.name === 'AbortError',
  );
});

test('palimpsest_list 在空范围下给出可执行提示', async () => {
  const sessionQuery = fakeSessionQuery({ listSessions: async () => [] });
  const tools = loadPlugin(sessionQuery);
  const out = await tools.get('palimpsest_list').execute({}, callContext());
  assert.match(out.content, /没有可读的历史会话/u);
  assert.match(out.content, /子代理会话未计/u);
  const withSubagents = await tools.get('palimpsest_list').execute({ includeSubagents: true }, callContext());
  assert.ok(!withSubagents.content.includes('子代理会话未计'));
});

test('palimpsest_search 回退扫描并给出片段与标题', async () => {
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => [record('session-a')],
    readTitleSnapshots: async (ids) =>
      ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: '移动端兼容性探讨' } } })),
    filterEvents: async () => [
      { sessionId: 'session-a', seq: 3, time: 2 * HOUR, type: 'user/message', surface: 'active', text: '我们决定用 zstd 多帧解码' },
    ],
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_search').execute({ query: 'zstd' }, callContext());
  assert.match(out.content, /逐会话扫描/u);
  assert.match(out.content, /zstd 多帧解码/u);
  assert.match(out.content, /「移动端兼容性探讨」/u);
  assert.ok(!out.content.includes('（无标题）'));
});

test('palimpsest_search 在无命中时提示换词', async () => {
  const sessionQuery = fakeSessionQuery({ listSessions: async () => [] });
  const out = await loadPlugin(sessionQuery).get('palimpsest_search').execute({ query: '不存在' }, callContext());
  assert.match(out.content, /没有命中/u);
});

test('palimpsest_read 默认排除系统与工具消息', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [
        { type: 'system/message', seq: 1, time: HOUR, data: { message: { content: [{ type: 'text', text: 'SYS-ONLY' }] } } },
        userEvent(2, 2 * HOUR, '用户提问'),
        { type: 'tool/result', seq: 3, time: 3 * HOUR, data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'TOOL-ONLY' }] }] } } },
        { type: 'assistant/message', seq: 4, time: 4 * HOUR, data: { message: { content: [{ type: 'text', text: '助手回答' }] } } },
      ],
    }),
    readTitle: async () => ({ title: '标题' }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'session-a' }, callContext());
  assert.match(out.content, /用户提问/u);
  assert.match(out.content, /助手回答/u);
  assert.ok(!out.content.includes('SYS-ONLY'));
  assert.ok(!out.content.includes('TOOL-ONLY'));
  assert.match(out.content, /已排除系统提示、工具结果与纯工具轨迹/u);
});

test('palimpsest_read 的 includeTools 放回工具结果', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [
        { type: 'tool/result', seq: 1, time: HOUR, data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: '工具结果' }] }] } } },
      ],
    }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'session-a', includeTools: true }, callContext());
  assert.match(out.content, /工具结果/u);
  // 头部说明必须跟着视图走：放回工具结果后，不能再声称「已排除工具结果」
  assert.match(out.content, /含工具结果，已排除系统提示/u);
  assert.ok(!out.content.includes('已排除系统提示、工具结果'));
});

test('palimpsest_read 的 last 只保留最近若干条', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [1, 2, 3, 4, 5].map((seq) => userEvent(seq, seq * HOUR, `第${seq}条`)),
    }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'session-a', last: 2 }, callContext());
  assert.match(out.content, /第4条/u);
  assert.match(out.content, /第5条/u);
  assert.ok(!out.content.includes('第3条'));
});

/** 造一个按 id 返回标题的批量标题服务。 */
function titled(titles) {
  return async (ids) =>
    ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: titles[sessionId] ?? '' } } }));
}

test('palimpsest_list 隐藏带私密标记的会话并如实告知', async () => {
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => [record('open', { createdAt: 2 }), record('secret', { createdAt: 1 })],
    listEvents: async () => [userEvent(1, HOUR, 'x')],
    readTitleSnapshots: titled({ open: '正常会话', secret: '[私密] 事故复盘' }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_list').execute({}, callContext());
  assert.match(out.content, /正常会话/u);
  assert.ok(!out.content.includes('事故复盘'));
  assert.match(out.content, /1 个会话带私密标记，已整段排除/u);
});

test('palimpsest_search 不返回带私密标记的会话', async () => {
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => [record('secret')],
    filterEvents: async () => [
      { sessionId: 'secret', seq: 1, time: HOUR, type: 'user/message', surface: 'active', text: '敏感内容' },
    ],
    readTitleSnapshots: titled({ secret: '[私密] 别读我' }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_search').execute({ query: '敏感' }, callContext());
  assert.ok(!out.content.includes('敏感内容'));
  assert.match(out.content, /没有命中/u);
});

test('palimpsest_read 拒绝私密会话，且不先把正文解出来', async () => {
  let surfaceReads = 0;
  const sessionQuery = fakeSessionQuery({
    readTitle: async () => ({ title: '[私密] 别读我' }),
    readSurface: async () => {
      surfaceReads += 1;
      return { session: { id: 'secret', cwd: '/work' }, events: [userEvent(1, HOUR, '机密正文')] };
    },
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'secret' }, callContext());
  assert.match(out.content, /带私密标记，已拒绝读取/u);
  assert.ok(!out.content.includes('机密正文'));
  assert.equal(surfaceReads, 0, '判定私密之前就把正文读出来了');
});

test('取回内容带不可信数据声明，凭据被打码并告知', async () => {
  const secret = ['sk', 'x'.repeat(24)].join('-');
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [userEvent(1, HOUR, `我当时的 key 是 ${secret}`)],
    }),
    readTitle: async () => ({ title: '标题' }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'session-a' }, callContext());
  assert.match(out.content, /不可信的历史数据/u);
  assert.match(out.content, /1 处疑似凭据已打码/u);
  assert.ok(!out.content.includes(secret));
});

test('palimpsest_read 报出会话不存在', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => {
      const error = new Error('会话不存在');
      error.code = 'SESSION_QUERY_SESSION_NOT_FOUND';
      throw error;
    },
  });
  const tool = loadPlugin(sessionQuery).get('palimpsest_read');
  await assert.rejects(() => tool.execute({ sessionId: 'missing' }, callContext()), /会话不存在/u);
});

test('palimpsest_search 拒绝空查询而不是谎报「没有命中」', async () => {
  const out = await loadPlugin(fakeSessionQuery()).get('palimpsest_search').execute({ query: '   ' }, callContext());
  assert.match(out.content, /query 不能为空/u);
  assert.ok(!out.content.includes('没有命中'));
});

test('palimpsest_list 读不出事件的会话显示「时间未知」而不是 1970', async () => {
  const sessionQuery = fakeSessionQuery({
    listSessions: async () => [record('session-a', { createdAt: 7 })],
    listEvents: async () => {
      throw new Error('会话损坏');
    },
    readTitle: async () => undefined,
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_list').execute({}, callContext());
  assert.match(out.content, /时间未知/u);
  assert.ok(!out.content.includes('1970'));
});

test('缺少会话工作目录时三个工具都失败关闭', async () => {
  const tools = loadPlugin(fakeSessionQuery());
  const noCwd = { agent: { session: { header: {} } } };
  for (const name of ['palimpsest_list', 'palimpsest_search', 'palimpsest_read']) {
    const args = name === 'palimpsest_search' ? { query: 'x' } : name === 'palimpsest_read' ? { sessionId: 's' } : {};
    const out = await tools.get(name).execute(args, noCwd);
    assert.match(out.content, /无法确定当前会话的工作目录/u, `${name} 未失败关闭`);
  }
});

test('palimpsest_read 拒绝读取其他工作目录的会话', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'foreign', cwd: '/elsewhere' },
      events: [userEvent(1, HOUR, '别的项目的秘密')],
    }),
  });
  const out = await loadPlugin(sessionQuery).get('palimpsest_read').execute({ sessionId: 'foreign' }, callContext('/work'));
  assert.match(out.content, /不在当前工作目录下，已拒绝读取/u);
  assert.ok(!out.content.includes('别的项目的秘密'));
});

test('palimpsest_read 指定 fromSeq 时向后读并给出续读起点', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [1, 2, 3, 4].map((seq) => userEvent(seq, seq * HOUR, `第${seq}条${'x'.repeat(200)}`)),
    }),
    readTitle: async () => ({ title: '标题' }),
  });
  const out = await loadPlugin(sessionQuery)
    .get('palimpsest_read')
    .execute({ sessionId: 'session-a', fromSeq: 1, last: 0, maxChars: 400 }, callContext());
  assert.match(out.content, /第1条/u, '应当从 fromSeq 处向后读');
  assert.match(out.content, /下一段用 fromSeq=/u);
});

test('palimpsest_read 未指定 fromSeq 时仍旧保留最近的尾部', async () => {
  const sessionQuery = fakeSessionQuery({
    readSurface: async () => ({
      session: { id: 'session-a', cwd: '/work' },
      events: [1, 2, 3, 4].map((seq) => userEvent(seq, seq * HOUR, `第${seq}条${'x'.repeat(200)}`)),
    }),
    readTitle: async () => ({ title: '标题' }),
  });
  const out = await loadPlugin(sessionQuery)
    .get('palimpsest_read')
    .execute({ sessionId: 'session-a', maxChars: 400 }, callContext());
  assert.match(out.content, /第4条/u, '应当保留最近的内容');
  assert.ok(!out.content.includes('下一段'));
});
