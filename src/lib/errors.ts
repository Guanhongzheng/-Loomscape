/**
 * Browsers do not throw only `Error`. A worker failure arrives as an
 * `ErrorEvent`, a storage problem as a `DOMException`, and a library may reject
 * with a plain object. Showing `error.message` on the last two leaves the
 * interface with an empty label, which reads like "something failed, no idea
 * what", so every catch funnels through here.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || '未知错误';
  }

  if (error && typeof error === 'object') {
    const row = error as { message?: unknown; name?: unknown; type?: unknown };
    if (typeof row.message === 'string' && row.message.trim()) return row.message.trim();
    if (typeof row.name === 'string' && row.name.trim()) return row.name.trim();
    if (typeof row.type === 'string' && row.type.trim()) {
      // ErrorEvent from a worker: the type is all there is.
      return `worker ${row.type}`;
    }
  }

  const text = String(error ?? '').trim();
  return text && text !== '[object Object]' ? text : '未知错误';
}

/** Errors that usually mean the tab is out of memory rather than out of luck. */
export function looksLikeMemoryPressure(message: string): boolean {
  return /out of memory|allocation|array buffer|memory access|rangeerror|aborted|oom/i.test(message);
}
