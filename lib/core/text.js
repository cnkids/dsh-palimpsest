// 内容块 → 纯文本。图片、文件等非文本块只留占位符：回忆历史时它们价值低，
// 却会成倍挤占上下文预算。

/** 非文本内容块的占位文本。 */
const PLACEHOLDER = {
  image: '[图片]',
  file: '[文件]',
};

/** 收窄为字符串，非字符串一律当空串。 */
function asText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * 抽取一个内容块的文本。
 * @param {object} block 模型可见内容块。
 * @returns {string} 该块的文本；无从提取时为空串。
 */
function blockToText(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text' || block.type === 'reasoning') return asText(block.text);
  if (block.type === 'tool-call') return `[调用 ${asText(block.name) || '未知工具'}]`;
  if (block.type === 'tool-result') return blocksToText(block.content);
  return PLACEHOLDER[block.type] ?? '';
}

/**
 * 把一个内容块数组压成换行连接的纯文本。
 * @param {unknown} content 内容块数组。
 * @returns {string} 非空块的文本，按原顺序用换行连接。
 */
export function blocksToText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    const text = blockToText(block);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}
