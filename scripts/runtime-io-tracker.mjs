// Preserve fetch/query results while counting unfinished work for shutdown.
export function installRuntimeIoTracker(target, Client) {
  let pending = 0, stopped = false;
  const intervals = new Set();
  const nativeInterval = target.setInterval.bind(target);
  const nativeFetch = target.fetch.bind(target);
  function tracked(promise) {
    pending++;
    return Promise.resolve(promise).finally(() => { pending--; });
  }
  target.setInterval = (callback, delay, ...args) => {
    const timer = nativeInterval(() => {
      if (stopped) return;
      const result = callback(...args);
      if (result?.then) void tracked(result).catch(error => console.error('[RUNTIME_INTERVAL]', error.message));
    }, delay);
    intervals.add(timer); return timer;
  };
  target.fetch = (...args) => tracked(nativeFetch(...args));
  const originalQuery = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const last = args.at(-1);
    if (typeof last === 'function') {
      pending++;
      args[args.length - 1] = (...result) => { try { return last(...result); } finally { pending--; } };
      try { return originalQuery.apply(this, args); } catch (error) { pending--; throw error; }
    }
    const result = originalQuery.apply(this, args);
    return result?.then ? tracked(result) : result;
  };
  return { pending: () => pending, nativeInterval,
    stopIntervals() { stopped = true; for (const timer of intervals) target.clearInterval(timer); } };
}
