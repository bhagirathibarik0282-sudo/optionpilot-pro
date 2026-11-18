import type { LiveEntry } from './dashboard-live-feed.js';

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 14;
const indiaDate = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);

export type PreviousSpotSession = {
  source: 'KITE_DAILY_CANDLE';
  symbol: 'NIFTY' | 'SENSEX';
  token: number;
  sessionDate: string;
  high: number;
  low: number;
  close: number;
};

export function parsePreviousSpotSession(
  payload: unknown, spot: LiveEntry, tradeDate: string,
): PreviousSpotSession | null {
  if (spot.role !== 'SPOT' || (spot.symbol !== 'NIFTY' && spot.symbol !== 'SENSEX') ||
      !Number.isSafeInteger(spot.token) || spot.token <= 0) return null;
  const tradeStart = Date.parse(tradeDate + 'T00:00:00+05:30');
  if (!Number.isFinite(tradeStart) || indiaDate(tradeStart) !== tradeDate) return null;
  const result = payload as { status?: unknown; data?: { candles?: unknown } } | null;
  const candles = result?.data?.candles;
  if (result?.status !== 'success' || !Array.isArray(candles) || candles.length > LOOKBACK_DAYS) return null;

  const dates = new Set<string>();
  let latest: { date: string; candle: unknown[] } | null = null;
  for (const candle of candles) {
    if (!Array.isArray(candle) || typeof candle[0] !== 'string' ||
        !/(Z|[+-]\d{2}:?\d{2})$/.test(candle[0])) return null;
    const stamp = Date.parse(candle[0]);
    if (!Number.isFinite(stamp)) return null;
    const date = indiaDate(stamp);
    if (date >= tradeDate || date < indiaDate(tradeStart - LOOKBACK_DAYS * DAY_MS) || dates.has(date)) return null;
    dates.add(date);
    if (!latest || date > latest.date) latest = { date, candle };
  }

  if (!latest) return null;
  const [, open, high, low, close] = latest.candle;
  if (typeof open !== 'number' || typeof high !== 'number' || typeof low !== 'number' ||
      typeof close !== 'number' || ![open, high, low, close].every(x => Number.isFinite(x) && x > 0) ||
      high < low || open < low || open > high || close < low || close > high) return null;
  return { source: 'KITE_DAILY_CANDLE', symbol: spot.symbol, token: spot.token,
    sessionDate: latest.date, high, low, close };
}

export async function fetchPreviousSpotSession(
  spot: LiveEntry, tradeDate: string, apiKey: string, accessToken: string,
): Promise<PreviousSpotSession | null> {
  const tradeStart = Date.parse(tradeDate + 'T00:00:00+05:30');
  const params = new URLSearchParams({
    from: indiaDate(tradeStart - LOOKBACK_DAYS * DAY_MS) + ' 00:00:00',
    to: indiaDate(tradeStart - DAY_MS) + ' 23:59:59',
  });
  const response = await fetch('https://api.kite.trade/instruments/historical/' + spot.token + '/day?' + params, {
    headers: { 'X-Kite-Version': '3', Authorization: 'token ' + apiKey + ':' + accessToken },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  return parsePreviousSpotSession(await response.json(), spot, tradeDate);
}
