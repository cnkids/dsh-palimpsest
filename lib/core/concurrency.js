// 受限并发：读会话日志要解压整个文件，一次放出几十个会同时占用大量内存与文件句柄，
// 因此并发度必须由调用方显式约束，而不是交给 Promise.all 无上限展开。

/** 把并发度收窄为至少 1 的整数。 */
function normalize(concurrency) {
  return Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
}

/**
 * 以受限并发处理条目，并保持输入顺序的结果。
 * @param {Array} items 待处理条目。
 * @param {number} concurrency 同时进行的上限。
 * @param {Function} mapper 单项处理函数，可返回 Promise。
 * @returns {Promise<Array>} 与输入同序的结果数组。
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const size = normalize(concurrency);
  const results = new Array(items.length);
  let cursor = 0;

  async function drain() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(size, items.length) }, drain);
  await Promise.all(workers);
  return results;
}

/**
 * 取消已经发出时立刻抛出。
 *
 * 用它而不是在循环里静默 return：用户按了停止之后，
 * 本插件不该还在后台把几十个会话日志解压一遍。
 * @param {AbortSignal} signal 调用方信号；缺失时什么都不做。
 */
export function throwIfAborted(signal) {
  signal?.throwIfAborted?.();
}

/**
 * 判断一个错误是否来自取消。
 * 取消必须向外传播：被兜底吞掉会让「用户已取消」看起来像「没有数据」。
 * @param {unknown} error 待判断的错误。
 * @returns {boolean} 是取消错误时为 true。
 */
export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'SESSION_QUERY_ABORTED';
}
