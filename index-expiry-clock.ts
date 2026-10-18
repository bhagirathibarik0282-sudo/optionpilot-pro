/** Standard-session model clock, not a contract-master or holiday validator.
 * SEBI 2026-01-16, para 4.2.3 / 6.1: 15:40 from 2026-08-03.
 * SEBI 2026-10-15, para 4.2.4 / 6.1: expiring index contracts
 * cease at 15:30 from 2026-12-07. Announcement dates prevent replay look-ahead.
 * Special sessions require separately verified timestamps; do not use this
 * resolver as proof that an instrument exists or that a market is open.
 */
export function resolveIndexExpiryClock(symbol: string, expiry: string, observedAt: string | number) {
  if (!['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(symbol)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const dateMs = Date.parse(expiry + 'T00:00:00.000Z');
  if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== expiry) return null;
  if (typeof observedAt === 'string' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt)) return null;
  const observedMs = typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(new Date(observedMs).getTime())) return null;
  const knowledgeClock = new Date(observedMs + 19_800_000);
  if (!Number.isFinite(knowledgeClock.getTime())) return null;
  const knowledgeDate = knowledgeClock.toISOString().slice(0, 10);
  // The circulars have dates, not verified intraday publication timestamps.
  // On either announcement day, withhold affected future-expiry estimates.
  if ((knowledgeDate === '2026-01-16' && expiry >= '2026-08-03') ||
      (knowledgeDate === '2026-10-15' && expiry >= '2026-12-07')) return null;
  const revised = expiry >= '2026-12-07' && knowledgeDate > '2026-10-15';
  const cas = !revised && expiry >= '2026-08-03' && knowledgeDate > '2026-01-16';
  const closeIst = cas ? '15:40' : '15:30';
  const expiryAt = expiry + (cas ? 'T10:10:00.000Z' : 'T10:00:00.000Z');
  const expiryMs = Date.parse(expiryAt);
  const remainingMs = expiryMs - observedMs;
  return {
    version: 'INDEX_STANDARD_EXPIRY_CLOCK_V1' as const,
    symbol, expiryAt, expiryMs, closeIst, knowledgeDate,
    rule: revised ? 'SEBI_20261015_EFFECTIVE_20261207' : cas ? 'SEBI_20260116_EFFECTIVE_20260803' : 'LEGACY_1530_MODEL_ASSUMPTION',
    standardSessionOnly: true as const,
    remainingMs,
    expired: remainingMs <= 0,
    minutesToExpiry: Math.max(0, remainingMs / 60_000),
    remainingCalendarDays: Math.max(0, remainingMs / 86_400_000),
  };
}
