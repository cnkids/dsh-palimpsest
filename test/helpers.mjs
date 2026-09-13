// 测试替身：一个只实现被调用方法的 sessionQuery。
// 放在独立文件里，避免测试文件互相 import 时重复注册用例。

export const HOUR = 60 * 60 * 1000;

/** 造一个 sessionQuery 替身，未覆盖的方法给出安全的空实现。 */
export function fakeSessionQuery(overrides = {}) {
  return {
    async listSessions() {
      return [];
    },
    async listEvents() {
      return [];
    },
    async readTitle() {
      return undefined;
    },
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: {} }));
    },
    async readSurface(sessionId) {
      // 真实 readSurface 一定同时返回会话头；工作目录要与 callContext 的默认值一致，
      // 否则会被插件的工作目录护栏拦下。
      return { session: { id: sessionId, cwd: '/work' }, events: [] };
    },
    async filterEvents() {
      return [];
    },
    async searchSessions() {
      const error = new Error('全文检索未启用');
      error.code = 'SESSION_QUERY_SEARCH_DISABLED';
      throw error;
    },
    ...overrides,
  };
}

/** 造一条逻辑会话记录。 */
export function record(id, { cwd = '/work', createdAt = 0, depth = 0 } = {}) {
  return { header: { id, cwd, createdAt, delegationDepth: depth }, live: false, persisted: true };
}

/** 造一条用户消息事件。 */
export function userEvent(seq, time, text) {
  return { type: 'user/message', seq, time, data: { role: 'user', content: [{ type: 'text', text }] } };
}

/** 造一条字面扫描命中的事件文档。 */
export function document(seq, time, text, sessionId = 'a') {
  return { sessionId, seq, time, type: 'user/message', surface: 'active', text };
}
