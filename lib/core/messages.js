// 会话事件 → 消息载荷的取值规则。
// `user/message` 的事件数据本身就是一条消息，其余三类把消息包在 `message`
// 字段下；这里抹平差异，让上游只面对一种形状。

/** 事件类型到对话角色的映射；不产生消息的事件类型不在表中。 */
const ROLE_OF_TYPE = {
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
  'system/message': 'system',
};

/**
 * 读取一个事件的对话角色。
 * @param {unknown} type 会话事件类型。
 * @returns {string} 角色名；非消息事件返回空串。
 */
export function roleOf(type) {
  return ROLE_OF_TYPE[type] ?? '';
}

/**
 * 取出事件里的消息载荷。
 * @param {object} event 形如 `{ type, data }` 的会话事件。
 * @returns {object|undefined} 带 `content` 数组的消息；取不到时返回 undefined。
 */
export function messageOf(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return undefined;
  if (Array.isArray(data.content)) return data;
  return data.message;
}
