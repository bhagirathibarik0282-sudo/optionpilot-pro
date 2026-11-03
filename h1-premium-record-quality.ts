/** Recorder eligibility only. Never changes selection, orders, or raw values. */
export function sourceQuoteAgeSeconds(timestamp: string | null, now: Date): number | null {
  const t = sourceMs(timestamp);
  return t === null || !Number.isFinite(now.getTime()) ? null : Math.floor((now.getTime() - t) / 1000);
}
function sourceMs(value: unknown): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function day(ms: number): string { return new Date(ms + 19_800_000).toISOString().slice(0, 10); }
export function premiumRecordStatus(input: {
  verdict: string; quoteTimestamp: string | null; now: Date;
  expiry: string; legExpiry: string | null; strike: number; ltp: number;
}): string {
  if (input.verdict !== "TRUE") return `DIAGNOSTIC_${input.verdict}`;
  const n = input.now.getTime(), q = sourceMs(input.quoteTimestamp);
  if (!Number.isFinite(n) || q === null) return "DIAGNOSTIC_SOURCE_TIME_MISSING";
  if (day(q) !== day(n)) return "DIAGNOSTIC_OTHER_SESSION";
  // Match the one-minute record cadence; allow the existing 5s source clock skew.
  if (q > n + 5000) return "DIAGNOSTIC_FUTURE_SOURCE_TIME";
  if (n - q > 60_000) return "DIAGNOSTIC_STALE_PREMIUM";
  const expiryMs = Date.parse(input.expiry + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiry) || !Number.isFinite(expiryMs)
    || new Date(expiryMs).toISOString().slice(0,10) !== input.expiry || input.legExpiry !== input.expiry
    || input.expiry < day(n) || !Number.isFinite(input.strike) || input.strike <= 0)
    return "DIAGNOSTIC_CONTRACT_IDENTITY";
  if (!Number.isFinite(input.ltp) || input.ltp <= 0) return "DIAGNOSTIC_INVALID_PRICE";
  return "RESEARCH_ELIGIBLE";
}
