// 「同一个工作目录」的判定。会话头里存的是创建时的绝对路径，
// 与本进程的工作目录逐字比较前先归一化尾部斜杠。

/**
 * 归一化工作目录。
 *
 * 去尾部斜杠用循环而不是正则：`/\/+$/` 在「一长串斜杠 + 非斜杠结尾」的输入上
 * 会因为贪心回溯退化成 O(N²)（SonarQube S5852 指出的正是这处），
 * 而循环是线性、也不可能触发回溯。
 *
 * **只去掉尾部斜杠，不 trim 首尾空白**：Unix/macOS 允许路径里带空白字符，
 * 而 `/work` 与 `/work `（尾部空格）是两个不同目录。早期实现先 trim 再比较，
 * 会把它们折叠成同一个范围 —— 锚定 `/work` 的会话因此能读到 `/work ` 下的会话
 * （安全审计 F4）。整串都是空白时仍旧返回 undefined（工作目录未知 → 失败关闭）。
 * @param {unknown} value 目录字符串。
 * @returns {string|undefined} 去掉尾部斜杠的路径；空值返回 undefined。
 */
export function normalizeCwd(value) {
  if (typeof value !== 'string') return undefined;
  if (!value.trim()) return undefined;
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end) || '/';
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
