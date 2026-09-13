// 面向模型的文本渲染：把对话条目与会话摘要拼成紧凑、可直接阅读的中文文本。
// 时间统一为本地 `YYYY-MM-DD HH:mm`，模型据此判断「上次」是哪一次。

import { clampHead, clampTail } from './limit.js';

/** 角色显示名。 */
const ROLE_LABEL = { user: '用户', assistant: '助手', tool: '工具', system: '系统' };

/** 补零到两位。 */
function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * 把毫秒时间戳格式化为本地 `YYYY-MM-DD HH:mm`。
 * @param {unknown} ms Unix 毫秒时间戳。
 * @returns {string} 可读时间；非法输入返回「时间未知」。
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '时间未知';
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 渲染一条对话条目。
 * @param {object} item 对话条目，含 `seq`、`time`、`role`、`text`。
 * @returns {string} 带角色、序号与时间的文本块。
 */
export function renderItem(item) {
  const label = ROLE_LABEL[item.role] ?? item.role;
  return `[${label} #${item.seq} ${formatTime(item.time)}]\n${item.text}`;
}

/**
 * 渲染完整对话，超长时保留最近的尾部。
 * @param {Array<object>} items 对话条目。
 * @param {object} options 头部说明与字符上限。
 * @returns {string} 可直接作为工具结果的文本。
 */
export function renderTranscript(items, options = {}) {
  const { heading = '', maxChars = 12000 } = options;
  const body = items.map(renderItem).join('\n\n');
  return clampTail(heading ? `${heading}\n\n${body}` : body, maxChars);
}

/** 渲染一行会话摘要的头部。 */
function renderSessionHead(index, entry) {
  const title = entry.title ? `「${entry.title}」` : '（无标题）';
  return `${index + 1}. ${entry.id}  ${title}`;
}

/**
 * 渲染一行会话摘要的细节，缺失的统计项不显示。
 * @param {object} entry 会话摘要。
 * @param {string} timeLabel 时间字段的含义标签 —— 列表里是「最后活跃」，
 *   搜索命中里只是「最近命中」（两条检索通道都不掌握会话的真实最后活跃时间）。
 * @returns {string} 缩进的一行说明。
 */
function renderSessionDetail(entry, timeLabel) {
  const parts = [`${timeLabel} ${formatTime(entry.lastTime)}`];
  if (Number.isFinite(entry.matchCount)) parts.push(`命中 ${entry.matchCount} 处`);
  if (Number.isFinite(entry.eventCount)) parts.push(`事件 ${entry.eventCount}`);
  if (Number.isFinite(entry.userMessages)) parts.push(`用户消息 ${entry.userMessages}`);
  return `   ${parts.join(' · ')}`;
}

/**
 * 渲染会话列表（或会话级搜索结果）。
 * @param {Array<object>} entries 会话摘要。
 * @param {object} options 头部说明与字符上限。
 * @returns {string} 按输入顺序渲染的文本。
 */
export function renderSessionList(entries, options = {}) {
  const { heading = '', maxChars = 8000 } = options;
  const body = entries
    .map((entry, index) => `${renderSessionHead(index, entry)}\n${renderSessionDetail(entry, '最后活跃')}`)
    .join('\n');
  return clampHead(heading ? `${heading}\n\n${body}` : body, maxChars);
}

/**
 * 从头渲染对话，达到字符上限就停，并告诉调用方下一段该从哪个 seq 继续。
 *
 * 用 `fromSeq` 分段读时必须是这个方向：**保留头部**才能顺着往下读。
 * 早期实现这里也走 clampTail（保留尾部），结果请求区间的前半段被丢掉——
 * 真机验收时模型正撞上这一点：它传了 fromSeq，拿到的却是会话末尾。
 * @param {Array<object>} items 对话条目，按事件顺序。
 * @param {object} options 头部说明与字符上限。
 * @returns {string} 可直接作为工具结果的文本。
 */
export function renderForward(items, options = {}) {
  const { heading = '', maxChars = 12000 } = options;
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 12000;
  const parts = [];
  let used = heading.length;
  let next;
  for (const item of items) {
    const line = renderItem(item);
    if (used + line.length > limit) {
      next = item.seq;
      break;
    }
    parts.push(line);
    used += line.length + 2;
  }
  // 一条都装不下时也必须给出内容：真机验收里出现过「只有游标、正文零字符」的空结果，
  // 调用方既看不到东西、也不知道发生了什么。截断展示第一条，游标指向下一条。
  if (!parts.length && items.length) {
    parts.push(renderItem(items[0]).slice(0, Math.max(200, limit - heading.length)));
    next = items[1]?.seq ?? items[0].seq;
  }
  const body = parts.join('\n\n');
  const more = Number.isFinite(next) ? `\n\n（已达输出上限，下一段用 fromSeq=${next} 继续）` : '';
  return `${heading}\n\n${body}${more}`;
}

/** 渲染一条带片段的搜索命中。 */
function renderHitDetail(entry) {
  const lines = [renderSessionDetail(entry, '最近命中')];
  for (const match of entry.matches ?? []) {
    lines.push(`   · #${match.seq} ${formatTime(match.time)} ${match.snippet}`);
  }
  return lines.join('\n');
}

/**
 * 渲染搜索命中列表，每条附上片段。
 * @param {Array<object>} entries 逐会话命中，含 `matches` 数组。
 * @param {object} options 头部说明与字符上限。
 * @returns {string} 按输入顺序渲染的文本。
 */
export function renderHitList(entries, options = {}) {
  const { heading = '', maxChars = 8000 } = options;
  const body = entries
    .map((entry, index) => `${renderSessionHead(index, entry)}\n${renderHitDetail(entry)}`)
    .join('\n\n');
  return clampHead(heading ? `${heading}\n\n${body}` : body, maxChars);
}
