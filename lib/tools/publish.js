// 工具统一出口。取回的历史文本在交给模型之前要过三道：
//   1. 打码已知形态的凭据；
//   2. 声明它是不可信数据（不是指令）；
//   3. 用带随机 token 的起止边界把数据包起来 —— 历史正文无法预知 token，
//      因此伪造不出"结束边界"，也就无法把后续内容伪装成边界之外的真指令（安全审计 F6）。

import { randomUUID } from 'node:crypto';
import { redact } from '../core/redact.js';
import { preface, DATA_BEGIN, DATA_END } from '../core/privacy.js';

/**
 * 给渲染好的输出打码、加上前置声明，并用起止边界包住数据。
 * @param {string} rendered 已渲染好的输出文本。
 * @param {number} hiddenCount 因私密标记被整段排除的会话数。
 * @param {number} unreadableCount 标题读不出来、已按私密处理跳过的会话数。
 * @returns {string} 可直接交给模型的文本。
 */
export function publish(rendered, hiddenCount = 0, unreadableCount = 0) {
  const { text, count } = redact(rendered);
  // 每次调用换一个边界 token：正文（可能由不可信内容诱导生成）预知不到它。
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  // 极端巧合或刻意构造时正文里可能出现同一个 token：先中和掉再拼边界。
  const body = text.split(token).join('·');
  return [
    preface(count, hiddenCount, unreadableCount),
    '',
    `${DATA_BEGIN} ${token}>>>`,
    body,
    `${DATA_END} ${token}>>>`,
  ].join('\n');
}
