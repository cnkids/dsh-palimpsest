// 回忆历史时，系统提示、工具结果与纯工具轨迹是噪音主体：
// 按角色和 `toolOnly` 标记把它们挡在默认视图之外，让上下文预算花在真正的对话上。

/** 判断一个条目是否保留。 */
function keep(item, includeTools, includeSystem) {
  if (item.role === 'system') return includeSystem;
  if (item.role === 'tool') return includeTools;
  if (item.toolOnly) return includeTools;
  return true;
}

/**
 * 按角色筛掉回忆里通常不需要的消息。
 * @param {Array<object>} items 对话条目。
 * @param {object} [options] 保留开关：`includeTools`、`includeSystem`，默认均为 false。
 * @returns {Array<object>} 过滤后的条目，保持原顺序。
 */
export function selectMessages(items, options = {}) {
  const { includeTools = false, includeSystem = false } = options;
  return items.filter((item) => keep(item, includeTools, includeSystem));
}
