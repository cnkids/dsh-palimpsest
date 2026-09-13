// 无全文索引时的回退排序。DSH 的全文索引会按 BM25 相关度排序，
// 字面扫描没有这个分数，用「命中处数」当相关度代理：真正讨论过某话题的会话
// 通常命中多次，顺带提到一句的会话只命中一两次。

/** 把未知计数收窄为可比较的数值。 */
function toCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 把未知时间收窄为可比较的数值。 */
function toTime(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * 按创建时间倒序，用于挑出「值得读日志」的有限候选窗口。
 * @param {object} left 会话记录，含 `header.createdAt`。
 * @param {object} right 会话记录。
 * @returns {number} 比较结果。
 */
export function byCreatedDesc(left, right) {
  return toTime(right?.header?.createdAt) - toTime(left?.header?.createdAt);
}

/** 命中处数多者在前；同分时最近命中的在前。 */
function byRelevance(left, right) {
  const byCount = toCount(right.matchCount) - toCount(left.matchCount);
  if (byCount === 0) return toTime(right.lastTime) - toTime(left.lastTime);
  return byCount;
}

/**
 * 按相关度排列会话命中。
 * @param {Array<object>} entries 逐会话命中，含 `matchCount` 与 `lastTime`。
 * @param {unknown} limit 返回的会话数上限；非正数表示不限。
 * @returns {Array<object>} 排序并截断后的新数组。
 */
export function rankSessionHits(entries, limit) {
  const sorted = [...entries].sort(byRelevance);
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) return sorted;
  return sorted.slice(0, Math.floor(numeric));
}
