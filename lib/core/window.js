// 按序号与条数截取对话条目，支撑「只读最后 N 条」和「从某个序号起分段读」。

/**
 * 从 `fromSeq`（含）开始，取末尾 `last` 条。
 * `last` 非正数表示不限制条数；`fromSeq` 之后没有条目时返回空 ——
 * 这比「悄悄从头开始」更安全，模型不会误以为读到的是指定区间。
 * @param {Array<object>} items 完整对话条目。
 * @param {object} [options] 含 `fromSeq` 与 `last`。
 * @returns {Array<object>} 截取后的条目。
 */
export function sliceMessages(items, options = {}) {
  const { fromSeq, last } = options;
  const index = Number.isFinite(fromSeq) ? items.findIndex((item) => item.seq >= fromSeq) : 0;
  if (index < 0) return [];
  const rest = items.slice(index);
  if (!Number.isFinite(last) || last <= 0) return rest;
  return rest.slice(Math.max(0, rest.length - last));
}
