import { isIndianEquityMarketOpenAt } from './market-session-calendar.js';
import { isClosingObservationAt } from './index-observation-session.js';

// Only automatic quote refreshes use this gate. Explicit reads, archives and
// trading eligibility retain their existing freshness and authority checks.
export function scheduledMarketRefreshAllowed(now = new Date()): boolean {
  return Number.isFinite(now.getTime()) &&
    (isIndianEquityMarketOpenAt(now) || isClosingObservationAt(now));
}

export function createScheduledMarketRefresh() {
  const active = new Set<string>();
  return async (key: string, task: () => Promise<void>, now = new Date()): Promise<void> => {
    if (!scheduledMarketRefreshAllowed(now) || active.has(key)) return;
    active.add(key);
    try {
      await task();
    } finally {
      active.delete(key);
    }
  };
}

export const runScheduledMarketRefresh = createScheduledMarketRefresh();
