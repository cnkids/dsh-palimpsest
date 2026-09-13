import { defineTool } from '@deepseek-ai/dsh-tools';
import { OUTPUT } from './output.js';
import { currentCwd, UNKNOWN_CWD_NOTICE } from './context.js';
import { publish } from './publish.js';
import { hidePrivate } from '../core/privacy.js';
import { listSessionsForCwd } from '../queries.js';
import { renderSessionList } from '../core/render.js';
import { clampCount } from '../core/limit.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CHARS = 8000;

const DESCRIPTION = [
  '列出与**当前工作目录相同**的历史会话（最近活跃的在前，含标题、最后活跃时间与规模）。',
  '当用户说「继续上次」「之前我们聊过」「你忘了吗」，或你需要回忆此前的决定、进度、约定时，',
  '先用本工具看清有哪些历史会话，再用 palimpsest_read 读取具体对话。当前会话自身也会出现在列表里。',
].join('');

const PARAMETERS = {
  limit: {
    type: 'integer',
    description: `最多返回多少个会话，默认 ${DEFAULT_LIMIT}，最大 ${MAX_LIMIT}。`,
  },
  includeSubagents: {
    type: 'boolean',
    description: '是否包含子代理会话，默认 false（只看你亲自参与的对话）。',
  },
};

/** 生成列表头部说明；空结果给出提示，候选被截断时如实说明。 */
function headingFor(cwd, result, includeSubagents) {
  if (!result.entries.length) {
    const note = includeSubagents ? '' : '（子代理会话未计）';
    return `当前工作目录 \`${cwd}\` 下没有可读的历史会话${note}。`;
  }
  const head = `当前工作目录 \`${cwd}\` 下最近活跃的 ${result.entries.length} 个历史会话。用 palimpsest_read 读取某个会话的完整对话。`;
  if (result.inspected < result.total) {
    return `${head}注意：仅按最近创建检查了 ${result.inspected} 个会话（范围内共 ${result.total} 个），更早的未参与排序。`;
  }
  return head;
}

/**
 * 创建 palimpsest_list 工具。
 * @param {object} ctx 宿主上下文，需带 sessionQuery 服务。
 * @returns {object} 注册用的工具定义。
 */
export function createListTool(ctx) {
  return defineTool({
    name: 'palimpsest_list',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      if (!cwd) return { content: UNKNOWN_CWD_NOTICE };
      const includeSubagents = args.includeSubagents === true;
      const result = await listSessionsForCwd(ctx.sessionQuery, {
        cwd,
        limit: clampCount(args.limit, DEFAULT_LIMIT, MAX_LIMIT),
        includeSubagents,
        signal: exec?.signal,
      });
      const { visible, hidden } = hidePrivate(result.entries);
      const heading = headingFor(cwd, { ...result, entries: visible }, includeSubagents);
      return { content: publish(renderSessionList(visible, { heading, maxChars: MAX_CHARS }), hidden) };
    },
  });
}
