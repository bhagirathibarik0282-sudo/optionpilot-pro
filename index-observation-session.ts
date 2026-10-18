import { indianEquityMarketPhaseAt, indianTradingDateAt } from './market-session-calendar.js';

/** Read/recording bounds only. Never use this as a candidate or order gate.
 * SEBI 2026-01-16 §4.2.3/6.1 and 2026-10-15 §4.2.4/6.1.
 * From December, 15:45 includes non-expiring contracts; expiring contracts
 * still cease at 15:30. Per-contract freshness/expiry checks remain necessary.
 */
export function standardIndexObservationClose(date: string): string {
  return date >= '2026-12-07' ? '15:45' : date >= '2026-08-03' ? '15:40' : '15:30';
}

export function isClosingObservationAt(now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const date = indianTradingDateAt(now);
  // The existing holiday calendar is reviewed for 2026 only. Special-session
  // overrides, including weekend Muhurat trading, are not inferred here.
  if (!date.startsWith('2026-')) return false;
  const phase = indianEquityMarketPhaseAt(now);
  if (phase === 'HOLIDAY' || phase === 'WEEKEND') return false;
  const shifted = new Date(now.getTime() + 19_800_000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const [hour, minute] = standardIndexObservationClose(date).split(':').map(Number);
  return minutes > 930 && minutes <= hour * 60 + minute;
}
