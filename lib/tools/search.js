import { defineTool } from '@deepseek-ai/dsh-tools';
import { OUTPUT } from './output.js';
import { currentCwd, currentSessionId, UNKNOWN_CWD_NOTICE } from './context.js';
import { publish } from './publish.js';
import { hidePrivate } from '../core/privacy.js';
import { searchSessions } from '../search.js';
import { renderHitList } from '../core/render.js';
import { clampCount } from '../core/limit.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_SNIPPET = 200;
const MAX_SNIPPET = 500;
const MAX_CHARS = 8000;

const DESCRIPTION = [
  '在**与当前工作目录相同**的历史会话里按关键词检索，返回命中的会话与上下文片段。',
  '已知文件名、函数名、报错文本、某个决定或专有名词时，用它直接定位记忆，比逐个 palimpsest_read 快得多。',
  '命中后用 palimpsest_read 读取该会话的完整上下文。检索按字面匹配，大小写不敏感。',
].join('');

const PARAMETERS = {
  query: {
    type: 'string',
    required: true,
    description: '要检索的关键词或短语，按字面匹配。',
  },
  limit: {
    type: 'integer',
    description: `最多返回多少个会话，默认 ${DEFAULT_LIMIT}，最大 ${MAX_LIMIT}。`,
  },
  snippetChars: {
    type: 'integer',
    description: `每条命中片段的字符数，默认 ${DEFAULT_SNIPPET}，最大 ${MAX_SNIPPET}。`,
  },
};

/** 通道名称：索引坏了要说坏了，不能说成「本来就没启用」。 */
function channelOf(result) {
  if (result.engine === 'index') return '全文索引';
  return result.degraded ? '逐会话扫描（索引调用失败）' : '逐会话扫描（全文索引未启用）';
}

/**
 * 生成检索头部说明。
 * 降级原因与扫描截断都必须写出来：否则「没命中」会被读成「整个工作目录都没有」。
 */
function headingFor(cwd, query, result) {
  const notes = [];
  if (result.degraded) notes.push(`全文索引调用失败（${result.degraded}），已降级为逐会话扫描。`);
  if (Number.isFinite(result.scanned) && result.scanned < result.total) {
    notes.push(`仅扫描了最近创建的 ${result.scanned} 个会话（范围内共 ${result.total} 个），更早的未参与匹配。`);
  }
  const tail = notes.length ? `\n${notes.join('\n')}` : '';
  const scope = `当前工作目录 \`${cwd}\``;
  if (!result.entries.length) {
    return `${scope} 下没有命中「${query}」的历史会话。可换个更短的关键词，或先用 palimpsest_list 看看有哪些会话。${tail}`;
  }
  return `${scope} 下命中「${query}」的会话（${result.entries.length} 个，经${channelOf(result)}）：${tail}`;
}

/** 归一化调用参数。 */
function requestOf(args, scope) {
  return {
    query: scope.query,
    cwd: scope.cwd,
    excludeSessionId: scope.excludeSessionId,
    signal: scope.signal,
    limit: clampCount(args.limit, DEFAULT_LIMIT, MAX_LIMIT),
    snippetChars: clampCount(args.snippetChars, DEFAULT_SNIPPET, MAX_SNIPPET),
  };
}

/**
 * 创建 palimpsest_search 工具。
 * @param {object} ctx 宿主上下文，需带 sessionQuery 服务。
 * @returns {object} 注册用的工具定义。
 */
export function createSearchTool(ctx) {
  return defineTool({
    name: 'palimpsest_search',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      if (!cwd) return { content: UNKNOWN_CWD_NOTICE };
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      // 空查询会被 DSH 判为非法；直接说清楚，别让它降级成「历史里没有」
      if (!query) return { content: '请提供要检索的关键词：query 不能为空或只有空白。' };
      const scope = { cwd, query, excludeSessionId: currentSessionId(exec), signal: exec?.signal };
      const result = await searchSessions(ctx.sessionQuery, requestOf(args, scope));
      const { visible, hidden } = hidePrivate(result.entries);
      const heading = headingFor(cwd, query, { ...result, entries: visible });
      return {
        content: publish(renderHitList(visible, { heading, maxChars: MAX_CHARS }), hidden, result.unreadable ?? 0),
      };
    },
  });
}
