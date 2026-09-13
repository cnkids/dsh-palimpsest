// 工具统一出口。取回的历史文本在交给模型之前要过两道：
// 打码已知形态的凭据，并声明它是不可信数据（不是指令）。

import { redact } from '../core/redact.js';
import { preface } from '../core/privacy.js';

/**
 * 给渲染好的输出打码并加上前置声明。
 * @param {string} rendered 已渲染好的输出文本。
 * @param {number} hiddenCount 因私密标记被整段排除的会话数。
 * @returns {string} 可直接交给模型的文本。
 */
export function publish(rendered, hiddenCount = 0) {
  const { text, count } = redact(rendered);
  return `${preface(count, hiddenCount)}\n\n${text}`;
}
