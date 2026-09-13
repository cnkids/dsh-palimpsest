// 「同一个工作目录」的判定。会话头里存的是创建时的绝对路径，
// 与本进程的工作目录逐字比较前先归一化尾部斜杠。

/**
 * 归一化工作目录。
 *
 * 去尾部斜杠用循环而不是正则：`/\/+$/` 在「一长串斜杠 + 非斜杠结尾」的输入上
 * 会因为贪心回溯退化成 O(N²)（SonarQube S5852 指出的正是这处），
 * 而循环是线性、也不可能触发回溯。
 * @param {unknown} value 目录字符串。
 * @returns {string|undefined} 去掉尾部斜杠的路径；空值返回 undefined。
 */
export function normalizeCwd(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '/') end -= 1;
  return trimmed.slice(0, end) || '/';
}

/**
 * 判断一个会话是否属于目标工作目录。
 * @param {object} header 会话头，含 `cwd`。
 * @param {string} cwd 目标工作目录。
 * @returns {boolean} 属于时为 true。
 */
export function matchesCwd(header, cwd) {
  const actual = normalizeCwd(header?.cwd);
  const wanted = normalizeCwd(cwd);
  return Boolean(actual) && actual === wanted;
}

/**
 * 判断一个会话是否落在本次调用的检索范围内。
 *
 * 列表与两条检索通道共用这一套规则：以前只在扫描通道过滤子代理，
 * 索引通道却放行，同一个问题在不同路径上给出不同答案。
 * @param {object} header 会话头。
 * @param {object} scope 含 `cwd`、`excludeSessionId`、`includeSubagents`。
 * @returns {boolean} 在范围内时为 true。
 */
export function inScope(header, scope) {
  if (!matchesCwd(header, scope.cwd)) return false;
  if (header?.id && header.id === scope.excludeSessionId) return false;
  if (scope.includeSubagents) return true;
  return !header?.delegationDepth;
}
