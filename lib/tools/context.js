// 调用现场的环境信息。记忆范围锚定在「发起调用的会话所在的工作目录」，
// 而不是插件进程的启动目录。

import { normalizeCwd } from '../core/scope.js';

/**
 * 取当前工具调用所在的工作目录。
 *
 * 只认调用方会话头里的 cwd，**故意不回退到 `process.cwd()`**：
 * 那是 dsh 服务的启动目录，不是本会话的工作目录，回退会悄悄把检索范围
 * 放大到另一个项目，与本插件「只读同一工作目录」的承诺相矛盾。
 * @param {object} exec 工具执行上下文，含调用方 agent。
 * @returns {string} 归一化的绝对路径；取不到时为空串，调用方应据此拒绝检索。
 */
export function currentCwd(exec) {
  return normalizeCwd(exec?.agent?.session?.header?.cwd) ?? '';
}

/**
 * 无法确定工作目录时的统一说明。
 * 宁可什么都不返回，也不猜一个目录去读别人的会话。
 */
export const UNKNOWN_CWD_NOTICE =
  '无法确定当前会话的工作目录，已跳过检索：宁可什么都不返回，也不猜一个目录去读别的项目的会话。';

/**
 * 取当前工具调用所在的会话 id。
 * 检索时要把它排除：调用方自己的历史已经在上下文里，当成「记忆命中」纯属噪音。
 * @param {object} exec 工具执行上下文，含调用方 agent。
 * @returns {string|undefined} 会话 id；取不到时 undefined。
 */
export function currentSessionId(exec) {
  const id = exec?.agent?.session?.header?.id;
  return typeof id === 'string' && id ? id : undefined;
}
