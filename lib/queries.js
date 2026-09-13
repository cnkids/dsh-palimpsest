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

/** 批量取标题；个别失败只影响该条。 */
async function titleMap(sessionQuery, ids) {
  if (!ids.length) return new Map();
  const results = await safe(() => sessionQuery.readTitleSnapshots(ids), []);
  const map = new Map();
  for (const result of results) {
    if (result?.status === 'fulfilled') map.set(result.sessionId, result.value?.title?.title ?? '');
  }
  return map;
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
 * @returns {Promise<{entries: Array<object>, total: number, inspected: number}>} 摘要、范围内总数与被检查数。
 */
export async function listSessionsForCwd(sessionQuery, options) {
  const { cwd, limit, includeSubagents = false, signal } = options;
  const records = await sessionQuery.listSessions(signal);
  const scoped = records.filter((record) => inScope(record.header, { cwd, includeSubagents }));
  const candidates = scoped
    .toSorted(byCreatedDesc)
    .slice(0, inspectionLimit(limit));
  const titles = await titleMap(sessionQuery, candidates.map((record) => record.header.id));
  const summaries = await mapWithConcurrency(candidates, SUMMARY_CONCURRENCY, (record) =>
    summarize(sessionQuery, record, { titles, signal }),
  );
  return {
    entries: summaries.toSorted(byRecency).slice(0, limit),
    total: scoped.length,
    inspected: candidates.length,
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
 * 批量补会话标题，个别失败只影响该条。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {Array<object>} entries 待补标题的条目，含 `id`。
 * @returns {Promise<Array<object>>} 补好标题的新数组。
 */
export async function attachTitles(sessionQuery, entries) {
  const titles = await titleMap(sessionQuery, entries.map((entry) => entry.id));
  return entries.map((entry) => ({ ...entry, title: titles.get(entry.id) ?? entry.title ?? '' }));
}
