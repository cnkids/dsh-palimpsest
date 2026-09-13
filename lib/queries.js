// 与 ctx.sessionQuery 的数据装配层。
// 职责：把 DSH 的会话记录/事件折成插件自己的摘要与对话条目，
// 并把单点失败隔离成「这一条没有」，而不是让整个工具调用失败。

import { toTranscript } from './core/transcript.js';
import { inScope } from './core/scope.js';
import { byCreatedDesc } from './core/scan.js';
import { isAbortError, mapWithConcurrency, throwIfAborted } from './core/concurrency.js';

/** 同时读取的会话日志上限，避免一次打开过多解码器。 */
const SUMMARY_CONCURRENCY = 6;

/**
 * 值得读日志的会话数下限与上限。
 * 读日志要解压整个会话文件，所以候选窗口必须有界：否则 limit=1 也会把
 * 工作目录下所有会话各读一遍，目录里会话一多就会拖到工具超时。
 */
const INSPECT_MIN = 30;
const INSPECT_MAX = 120;

/**
 * 执行一次可能失败的数据读取，失败时返回兜底值。
 * 取消错误例外：它必须向外传播，否则「用户已取消」会被伪装成「没有数据」。
 * @param {Function} run 异步读取。
 * @param {unknown} fallback 失败时的返回值。
 * @returns {Promise<unknown>} 读取结果或兜底值。
 */
export async function safe(run, fallback) {
  try {
    return await run();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return fallback;
  }
}

/** 统计一个会话的事件数与活跃时间；读不出事件时活跃时间为未知而不是 0。 */
function countEvents(events) {
  let lastTime;
  let userMessages = 0;
  for (const event of events) {
    if (Number.isFinite(event?.time)) lastTime = Math.max(lastTime ?? 0, event.time);
    if (event?.type === 'user/message') userMessages += 1;
  }
  return { lastTime, eventCount: Array.isArray(events) ? events.length : 0, userMessages };
}

/** 由调用方要的数量推出候选窗口大小。 */
function inspectionLimit(limit) {
  const wanted = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : INSPECT_MIN;
  return Math.min(INSPECT_MAX, Math.max(INSPECT_MIN, wanted * 3));
}

/** 按最后活跃时间倒序。 */
function byRecency(left, right) {
  return (right.lastTime ?? 0) - (left.lastTime ?? 0);
}

/**
 * 批量取标题；同时回报「读不出来」的 id。
 *
 * 失败必须与「没有标题」区分开（安全审计 F1）：宿主 projectMany 在持久化列举失败时
 * 会把整批 id 标成 rejected，个别 id 也可能被单独拒。这些会话的私密标记是**未知**的，
 * 不能当成「没有标记」——调用方对未知的一律按私密处理（失败关闭）。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {Array<string>} ids 会话 id。
 * @returns {Promise<{titles: Map<string, string>, unreadable: Set<string>}>} 标题表与不可读 id 集合。
 */
async function titleMap(sessionQuery, ids) {
  const titles = new Map();
  const unreadable = new Set();
  if (!ids.length) return { titles, unreadable };
  let results;
  try {
    results = await sessionQuery.readTitleSnapshots(ids);
  } catch (error) {
    if (isAbortError(error)) throw error;
    for (const id of ids) unreadable.add(id);
    return { titles, unreadable };
  }
  const seen = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const id = result?.sessionId;
    if (typeof id !== 'string') continue;
    seen.add(id);
    if (result.status === 'fulfilled') titles.set(id, result.value?.title?.title ?? '');
    else unreadable.add(id);
  }
  // 批量接口没回话的 id 同样算「读不出来」
  for (const id of ids) if (!seen.has(id)) unreadable.add(id);
  return { titles, unreadable };
}

/** 把一个会话记录折成摘要；标题来自批量结果，日志读失败则统计为空。 */
async function summarize(sessionQuery, record, context) {
  throwIfAborted(context.signal);
  const id = record.header.id;
  const events = await safe(() => sessionQuery.listEvents(id), []);
  return {
    id,
    title: context.titles.get(id) ?? '',
    createdAt: record.header.createdAt,
    ...countEvents(events),
  };
}

/**
 * 列出与给定工作目录相同的历史会话。
 *
 * 先按创建时间取一个有限候选窗口，再在窗口内按真实活跃时间排序：
 * 读日志是有成本的，不能为了排序把范围内所有会话都读一遍。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {object} options 含 `cwd`、`limit`、`includeSubagents`、`signal`。
 * @returns {Promise<{entries: Array<object>, total: number, inspected: number, unreadable: number}>} 摘要、范围内总数、被检查数与因标题不可读被剔除数。
 */
export async function listSessionsForCwd(sessionQuery, options) {
  const { cwd, limit, includeSubagents = false, signal } = options;
  const records = await sessionQuery.listSessions(signal);
  const scoped = records.filter((record) => inScope(record.header, { cwd, includeSubagents }));
  const candidates = scoped
    .toSorted(byCreatedDesc)
    .slice(0, inspectionLimit(limit));
  const { titles, unreadable } = await titleMap(sessionQuery, candidates.map((record) => record.header.id));
  // 标题读不出来的会话不能出现在列表里：它们的私密标记未知（失败关闭，见 titleMap）
  const readable = candidates.filter((record) => !unreadable.has(record.header.id));
  const summaries = await mapWithConcurrency(readable, SUMMARY_CONCURRENCY, (record) =>
    summarize(sessionQuery, record, { titles, signal }),
  );
  return {
    entries: summaries.toSorted(byRecency).slice(0, limit),
    total: scoped.length,
    inspected: candidates.length,
    unreadable: unreadable.size,
  };
}

/**
 * 读取一个会话的完整对话条目，连同它的会话头。
 * 会话头要一并返回：调用方得靠它校验目标会话是否属于当前工作目录。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {string} sessionId 会话 id。
 * @returns {Promise<{session: object|undefined, items: Array<object>}>} 会话头与对话条目。
 */
export async function transcriptOf(sessionQuery, sessionId) {
  const surface = await sessionQuery.readSurface(sessionId);
  return { session: surface?.session, items: toTranscript(surface?.events) };
}

/**
 * 批量补会话标题，并剔除标题读不出来的条目。
 *
 * 剔除而不保留原值是刻意的（安全审计 F1）：原值可能为空，而空标题会让
 * hidePrivate 把带私密标记的会话当普通会话放行。读不出来就按私密处理。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {Array<object>} entries 待补标题的条目，含 `id`。
 * @returns {Promise<{entries: Array<object>, unreadable: number}>} 补好标题的条目与被剔除的数量。
 */
export async function attachTitles(sessionQuery, entries) {
  const { titles, unreadable } = await titleMap(sessionQuery, entries.map((entry) => entry.id));
  const kept = entries
    .filter((entry) => !unreadable.has(entry.id))
    .map((entry) => ({ ...entry, title: titles.get(entry.id) ?? entry.title ?? '' }));
  return { entries: kept, unreadable: unreadable.size };
}
