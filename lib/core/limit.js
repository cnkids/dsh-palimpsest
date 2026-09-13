// 输出长度护栏：历史会话可能比当前上下文预算大得多，超长时必须截断，
// 并按内容重要性选择保留头部还是尾部。

/** 把字符数收窄为正整数，非法输入返回 0（表示不限）。 */
function positive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

/**
 * 超长时截断并保留尾部 —— 读对话时最近的记忆最重要。
 * @param {string} text 完整文本。
 * @param {unknown} maxChars 字符上限。
 * @returns {string} 受上限约束的文本。
 */
export function clampTail(text, maxChars) {
  const limit = positive(maxChars);
  if (!limit || text.length <= limit) return text;
  return `（内容过长，已省略较早的 ${text.length - limit} 个字符；可用 fromSeq 分段读取）\n${text.slice(text.length - limit)}`;
}

/**
 * 超长时截断并保留头部 —— 列表与搜索结果已按相关性排序，前面的更重要。
 * @param {string} text 完整文本。
 * @param {unknown} maxChars 字符上限。
 * @returns {string} 受上限约束的文本。
 */
export function clampHead(text, maxChars) {
  const limit = positive(maxChars);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n（已截断，共 ${text.length} 个字符；可缩小 limit 或提高 maxChars）`;
}

/**
 * 把模型给的数量收窄到 `[1, max]`，非法值退回缺省值。
 * @param {unknown} value 原始参数。
 * @param {number} fallback 缺省数量。
 * @param {number} max 允许的上限。
 * @returns {number} 合法的数量。
 */
export function clampCount(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), max);
}
