// 工作目录范围的关键词检索：优先走 DSH 全文索引，
// 索引未启用时回退到「逐会话字面扫描」，因此插件开箱即用、不依赖全局配置改动。

import { safe, attachTitles } from './queries.js';
import { rankSessionHits, byCreatedDesc } from './core/scan.js';
import { snippetAround } from './core/snippet.js';
import { inScope, normalizeCwd } from './core/scope.js';
import { isAbortError, mapWithConcurrency, throwIfAborted } from './core/concurrency.js';

/** 字面回退时最多检查的会话数，避免一次搜索读爆整个历史。 */
const SCAN_SESSION_LIMIT = 40;

/** 同时读取的会话日志上限。 */
const SCAN_CONCURRENCY = 4;

/** 每个会话最多带回的命中片段数；命中总数另计。 */
const MATCHES_PER_SESSION = 3;

/** DSH 明确表示「全文检索未启用」，这是正常状态而不是故障。 */
const SEARCH_DISABLED = 'SESSION_QUERY_SEARCH_DISABLED';

/** 组装全文索引请求；工作目录缺失时退回全局检索。 */
function indexRequest(request) {
  const cwd = normalizeCwd(request.cwd);
  const base = { query: request.query, limit: request.limit };
  return cwd ? { ...base, sessionFilters: [{ kind: 'cwd', values: [cwd] }] } : base;
}

/** 清点入参必须把取消信号一起交给 DSH，否则按了停止它也不会停。 */
function execContext(request) {
  return request.signal ? { signal: request.signal } : undefined;
}

/**
 * 尝试走全文索引通道。
 * 取消要向外抛；其余失败降级为扫描，并把失败原因带回给调用方，
 * 不能把「索引坏了」说成「索引本来就没开」。
 */
async function attemptIndex(sessionQuery, request) {
  try {
    return { page: await sessionQuery.searchSessions(indexRequest(request), execContext(request)) };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { error };
  }
}

/** 索引未启用是正常状态；其他失败才算降级，需要如实告知。 */
function degradationOf(error) {
  if (!error || error.code === SEARCH_DISABLED) return undefined;
  return error.code || error.message || '全文索引调用失败';
}

/** 全文索引命中 → 统一条目形状。 */
function toIndexEntry(hit) {
  const best = hit.bestMatch ?? {};
  return {
    id: hit.header.id,
    title: '',
    lastTime: Number.isFinite(best.time) ? best.time : hit.header.createdAt,
    matches: [{ seq: best.seq, time: best.time, snippet: best.snippet ?? '' }],
  };
}

/** 索引结果按与其他通道相同的范围规则过滤；分页内相对次序是相关度，必须原样保留。 */
function indexEntries(page, request) {
  return page.items.filter((hit) => inScope(hit.header, request)).map(toIndexEntry);
}

/** 取一个会话内命中该关键词的全部事件。 */
async function matchingDocuments(sessionQuery, sessionId, query) {
  return safe(() => sessionQuery.filterEvents(sessionId, [{ kind: 'text', text: query }]), []);
}

/** 最近一次命中的时间；用归约而非展开，避免超长数组撑爆调用栈。 */
function lastHitTime(documents) {
  return documents.reduce((latest, doc) => (Number.isFinite(doc.time) && doc.time > latest ? doc.time : latest), 0);
}

/** 扫描命中 → 统一条目形状，只展示前几处片段，另记命中总数供排序与展示。 */
function toScanEntry(record, documents, request) {
  return {
    id: record.header.id,
    title: '',
    lastTime: Math.max(record.header.createdAt, lastHitTime(documents)),
    matchCount: documents.length,
    matches: documents.slice(0, MATCHES_PER_SESSION).map((doc) => ({
      seq: doc.seq,
      time: doc.time,
      snippet: snippetAround(doc.text, request.query, request.snippetChars),
    })),
  };
}

/**
 * 逐会话字面扫描；每个候选只读一次会话日志，并发受限。
 * 候选按创建时间截断，所以要如实回报「扫了几个 / 范围内共几个」。
 */
async function scanSessions(sessionQuery, request) {
  const records = await sessionQuery.listSessions(request.signal);
  const scoped = records.filter((record) => inScope(record.header, request));
  const candidates = scoped.toSorted(byCreatedDesc).slice(0, SCAN_SESSION_LIMIT);
  const found = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, async (record) => {
    throwIfAborted(request.signal);
    const documents = await matchingDocuments(sessionQuery, record.header.id, request.query);
    return documents.length ? toScanEntry(record, documents, request) : undefined;
  });
  return {
    entries: rankSessionHits(found.filter(Boolean), request.limit),
    scanned: candidates.length,
    total: scoped.length,
  };
}

/**
 * 在工作目录范围内按关键词检索历史会话。
 * 两条通道的结果统一补标题，模型才能靠标题认出「是哪次对话」。
 * @param {object} sessionQuery ctx.sessionQuery 服务。
 * @param {object} request 含 `query`、`cwd`、`limit`、`snippetChars`、`excludeSessionId`、`signal`。
 * @returns {Promise<object>} 检索通道、命中、扫描规模与降级原因。
 */
export async function searchSessions(sessionQuery, request) {
  const attempt = await attemptIndex(sessionQuery, request);
  if (attempt.page) {
    return {
      engine: 'index',
      entries: await attachTitles(sessionQuery, indexEntries(attempt.page, request)),
    };
  }
  const { entries, scanned, total } = await scanSessions(sessionQuery, request);
  return {
    engine: 'scan',
    degraded: degradationOf(attempt.error),
    scanned,
    total,
    entries: await attachTitles(sessionQuery, entries),
  };
}
