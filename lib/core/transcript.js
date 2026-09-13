import { blocksToText } from './text.js';
import { messageOf, roleOf } from './messages.js';

/** 判断内容里是否存在实质文本，而不是只有工具调用或附件占位。 */
function hasSubstance(content) {
  if (!Array.isArray(content)) return false;
  return content.some((block) => block?.type === 'text' || block?.type === 'reasoning');
}

/** 单个事件 → 对话条目；不产出可读文本时返回 undefined。 */
function toItem(event) {
  const role = roleOf(event?.type);
  if (!role) return undefined;
  const content = messageOf(event)?.content;
  const text = blocksToText(content).trim();
  if (!text) return undefined;
  return { seq: event.seq, time: event.time, role, text, toolOnly: !hasSubstance(content) };
}

/**
 * 把会话的模型可见事件折成有序对话条目。
 * 完全渲染不出文本的条目（空消息、无输出的步骤）直接丢弃；
 * 只有工具轨迹或附件、没有实质文本的条目带 `toolOnly` 标记，交由下游按需过滤。
 * @param {unknown} events 会话的 surface 事件数组。
 * @returns {Array<object>} 对话条目，含 `seq`、`time`、`role`、`text`、`toolOnly`。
 */
export function toTranscript(events) {
  if (!Array.isArray(events)) return [];
  const items = [];
  for (const event of events) {
    const item = toItem(event);
    if (item) items.push(item);
  }
  return items;
}
