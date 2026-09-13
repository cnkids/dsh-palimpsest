// dsh-palimpsest — DSH 宿主插件（仅宿主侧，无前端半边）。
// 注册三个只读工具，让智能体在**新会话**里按需取回同一工作目录下历史会话的记忆。
//
// 数据来源是 DSH 自带的 `ctx.sessionQuery` 服务：精确读取、标题折叠与字面过滤
// 在默认配置下即可用；全文索引关闭时会自动回退到逐会话扫描，不需要改全局配置。

import { createListTool } from './tools/list.js';
import { createSearchTool } from './tools/search.js';
import { createReadTool } from './tools/read.js';

export const name = 'palimpsest';

/** 依赖宿主已有的工具注册表与跨会话查询服务。 */
export const inject = ['tools', 'sessionQuery'];

/**
 * 注册记忆检索工具。
 * @param {object} ctx 宿主上下文，携带 tools 与 sessionQuery。
 */
export function apply(ctx) {
  ctx.tools.register(createListTool(ctx));
  ctx.tools.register(createSearchTool(ctx));
  ctx.tools.register(createReadTool(ctx));
}
