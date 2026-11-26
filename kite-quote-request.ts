// Quote REST callers share a one-request-per-second budget in this process.
// Keep the wait outside the HTTP timeout and fail closed if the quote is no longer needed.
export function createKiteQuoteLimiter({
  now = Date.now,
  wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
} = {}) {
  let nextStart = 0;
  let tail = Promise.resolve();
  let queued = 0;

  return async function request(send: () => Promise<Response>, isCurrent = () => true): Promise<Response> {
    if (queued >= 12) throw new Error('KITE_QUOTE_QUEUE_FULL');
    const deadline = now() + 12_000;
    queued++;
    const turn = tail.then(async () => {
      while (nextStart > now()) {
        if (nextStart > deadline || !isCurrent()) throw new Error('KITE_QUOTE_REQUEST_EXPIRED');
        await wait(nextStart - now());
      }
      if (now() > deadline || !isCurrent()) throw new Error('KITE_QUOTE_REQUEST_EXPIRED');
      nextStart = now() + 1_100;
      const response = send().then(result => {
        if (result.status === 429) {
          const hint = result.headers.get('Retry-After');
          const seconds = hint && /^\d+$/.test(hint) ? Number(hint) : NaN;
          const delay = Number.isSafeInteger(seconds) ? seconds * 1_000 : Date.parse(hint ?? '') - now();
          nextStart = Math.max(nextStart, now() + Math.max(2_000, Number.isFinite(delay) ? delay : 0));
        }
        return result;
      });
      return { response };
    }).finally(() => { queued--; });
    tail = turn.then(() => {}, () => {});
    return (await turn).response;
  };
}

export const requestKiteQuote = createKiteQuoteLimiter();
