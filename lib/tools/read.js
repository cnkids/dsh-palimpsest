import { defineTool } from '@deepseek-ai/dsh-tools';
import { OUTPUT } from './output.js';
import { currentCwd, UNKNOWN_CWD_NOTICE } from './context.js';
import { transcriptOf, safe } from '../queries.js';
import { selectMessages } from '../core/filter.js';
import { sliceMessages } from '../core/window.js';
import { renderTranscript, renderForward } from '../core/render.js';
import { clampCount } from '../core/limit.js';
import { matchesCwd } from '../core/scope.js';
import { throwIfAborted } from '../core/concurrency.js';
import { isPrivateTitle } from '../core/privacy.js';
import { publish } from './publish.js';

const DEFAULT_LAST = 30;
const MAX_LAST = 500;
const DEFAULT_MAX_CHARS = 12000;
const MAX_MAX_CHARS = 60000;

const DESCRIPTION = [
  '读取一个历史会话的对话内容（用户与助手的文本；默认不含工具结果与系统提示）。',
  '先用 palimpsest_list 或 palimpsest_search 取得 sessionId。',
  `默认只返回最后 ${DEFAULT_LAST} 条消息；内容超长时保留最近的并提示省略量，`,
  '需要更早的内容时用 fromSeq 从指定事件序号往前读。',
].join('');

const PARAMETERS = {
  sessionId: {
    type: 'string',
    required: true,
    description: '要读取的会话 id，例如 session-09a739ce-…。',
  },
  last: {
    type: 'integer',
    description: `只返回最后 N 条消息，默认 ${DEFAULT_LAST}；传 0 表示全部。`,
  },
  fromSeq: {
    type: 'integer',
    description: '从该事件序号（含）开始向后读，用于分段读取超长会话；达到输出上限时会给出下一段的 fromSeq。',
  },
  includeTools: {
    type: 'boolean',
    description: '是否包含工具结果，默认 false。',
  },
  maxChars: {
    type: 'integer',
    description: `输出字符上限，默认 ${DEFAULT_MAX_CHARS}。`,
  },
};

/** `last` 参数语义：0 表示不限条数，其余收窄到 [1, MAX_LAST]。 */
function resolveLast(value) {
  return value === 0 ? 0 : clampCount(value, DEFAULT_LAST, MAX_LAST);
}

/** 描述当前视图排除了什么，避免头部说明与实际内容不符。 */
function describeScope(includeTools) {
  return includeTools ? '（含工具结果，已排除系统提示）' : '（已排除系统提示、工具结果与纯工具轨迹）';
}

/** 生成读取头部说明。 */
function headingFor({ sessionId, title, shown, total, includeTools }) {
  const name = title ? `会话 ${sessionId}「${title}」` : `会话 ${sessionId}`;
  return `${name}：共 ${total} 条消息${describeScope(includeTools)}，以下为 ${shown} 条。`;
}

/** 目标会话不属于当前工作目录时的拒绝说明。 */
function outOfScopeNotice(sessionId) {
  return `会话 ${sessionId} 不在当前工作目录下，已拒绝读取：本工具只读同一工作目录的历史会话。`;
}

/** 目标会话带私密标记时的拒绝说明。 */
function privateNotice(sessionId) {
  return `会话 ${sessionId} 带私密标记，已拒绝读取：把标题里的标记去掉才能被回忆。`;
}

/**
 * 创建 palimpsest_read 工具。
 * @param {object} ctx 宿主上下文，需带 sessionQuery 服务。
 * @returns {object} 注册用的工具定义。
 */
export function createReadTool(ctx) {
  return defineTool({
    name: 'palimpsest_read',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: OUTPUT,
    async execute(args, exec) {
      const sessionId = args.sessionId;
      const cwd = currentCwd(exec);
      if (!cwd) return { content: UNKNOWN_CWD_NOTICE };
      throwIfAborted(exec?.signal);
      const includeTools = args.includeTools === true;
      const title = await safe(() => ctx.sessionQuery.readTitle(sessionId), undefined);
      // 私密标记要在解出正文**之前**判定：不该先把整段对话读出来，再决定给不给
      if (isPrivateTitle(title?.title)) return { content: privateNotice(sessionId) };
      const { session, items } = await transcriptOf(ctx.sessionQuery, sessionId);
      // id 会随对话文本在会话之间流转，所以不能只凭 id 就交出内容
      if (!matchesCwd(session, cwd)) return { content: outOfScopeNotice(sessionId) };
      const selected = selectMessages(items, { includeTools });
      const shown = sliceMessages(selected, { fromSeq: args.fromSeq, last: resolveLast(args.last) });
      const heading = headingFor({
        sessionId,
        title: title?.title ?? '',
        shown: shown.length,
        total: selected.length,
        includeTools,
      });
      const maxChars = clampCount(args.maxChars, DEFAULT_MAX_CHARS, MAX_MAX_CHARS);
      // 指定了 fromSeq 就是「从这里往后读」，超限要保留头部并给出下一段起点；
      // 否则是「读最近的」，超限保留尾部。
      const content = Number.isFinite(args.fromSeq)
        ? renderForward(shown, { heading, maxChars })
        : renderTranscript(shown, { heading, maxChars });
      return { content: publish(content) };
    },
  });
}
