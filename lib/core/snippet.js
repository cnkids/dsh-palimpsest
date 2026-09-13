// 搜索片段截取：为命中事件生成围绕关键词的短预览，避免把整段历史塞进上下文。

/** 压平空白：换行与连续空白折成单个空格，便于单行预览与定位。 */
function flatten(text) {
  return typeof text === 'string' ? text.replaceAll(/\s+/gu, ' ').trim() : '';
}

/**
 * 在已压平空白的正文里定位关键词。
 *
 * 正文与查询都先压平空白，于是普通子串查找天然具备「空白灵活」语义
 * （`foo  bar` 能命中 `foo   bar`，但命中不了 `foobar`，与 DSH 的字面过滤一致）。
 * 这**故意不用正则**：把查询编译成正则既是安全热点（ReDoS），也要额外做元字符转义。
 * @param {string} flat 已压平空白的正文。
 * @param {unknown} query 原始查询。
 * @returns {{index: number, length: number}|undefined} 命中位置与长度。
 */
function locate(flat, query) {
  const needle = flatten(query);
  if (!needle) return undefined;
  const index = flat.toLowerCase().indexOf(needle.toLowerCase());
  return index < 0 ? undefined : { index, length: needle.length };
}

/**
 * 在文本里截取围绕关键词的片段。
 * @param {unknown} text 原始文本。
 * @param {string} query 关键词。
 * @param {unknown} maxChars 片段字符上限。
 * @returns {string} 带省略号的片段；关键词缺失时退化为文本开头。
 */
export function snippetAround(text, query, maxChars) {
  const flat = flatten(text);
  const numeric = Number(maxChars);
  const limit = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 200;
  if (flat.length <= limit) return flat;
  const match = locate(flat, query);
  if (!match) return `${flat.slice(0, limit)}…`;
  const half = Math.max(0, Math.floor((limit - match.length) / 2));
  const start = Math.max(0, match.index - half);
  const end = Math.min(flat.length, start + limit);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
