import { isIndianEquityMarketOpenAt, indianTradingDateAt } from './market-session-calendar.js';

export const KEY_STOCKS = {
  NIFTY: { 'HDFC Bank': 'NSE:HDFCBANK', Reliance: 'NSE:RELIANCE', 'ICICI Bank': 'NSE:ICICIBANK', Infosys: 'NSE:INFY', SBI: 'NSE:SBIN' },
  BANKNIFTY: { 'HDFC Bank': 'NSE:HDFCBANK', 'ICICI Bank': 'NSE:ICICIBANK', SBI: 'NSE:SBIN', 'Axis Bank': 'NSE:AXISBANK', 'Kotak Mahindra Bank': 'NSE:KOTAKBANK' },
  SENSEX: { Reliance: 'NSE:RELIANCE', 'HDFC Bank': 'NSE:HDFCBANK', 'ICICI Bank': 'NSE:ICICIBANK', TCS: 'NSE:TCS', Infosys: 'NSE:INFY' },
} as const;
export const SECTORS = {
  'Nifty PSU Bank': 'NSE:NIFTY PSU BANK', 'Nifty Smallcap 100': 'NSE:NIFTY SMLCAP 100',
  'Nifty Midcap 100': 'NSE:NIFTY MIDCAP 100', 'Nifty IT': 'NSE:NIFTY IT',
  'Nifty Oil & Gas': 'NSE:NIFTY OIL AND GAS', 'Nifty Financial Services': 'NSE:NIFTY FIN SERVICE',
  'Nifty Auto': 'NSE:NIFTY AUTO', 'Nifty FMCG': 'NSE:NIFTY FMCG',
} as const;
export const QUOTE_SYMBOLS = [...new Set([...Object.values(KEY_STOCKS).flatMap(Object.values), ...Object.values(SECTORS)])];
type Quote = { last_price?: unknown; volume?: unknown; timestamp?: unknown; ohlc?: { close?: unknown } };
export type QuoteMap = Record<string, Quote>;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
function observation(q?: Quote) {
  const price = finite(q?.last_price), close = finite(q?.ohlc?.close);
  return { price, change: price !== null && close !== null && close > 0 ? (price - close) / close * 100 : null,
    volume: finite(q?.volume), exchangeTimestamp: typeof q?.timestamp === 'string' ? q.timestamp : null };
}
export function buildBackgroundQuotes(quotes: QuoteMap, now: Date) {
  const stocks = Object.fromEntries(Object.entries(KEY_STOCKS).map(([index, names]) => [index,
    Object.entries(names).map(([name, symbol]) => ({ name, ...observation(quotes[symbol]) }))]));
  const sectors = Object.entries(SECTORS).map(([name, symbol]) => {
    const q = observation(quotes[symbol]);
    const pct = q.change === null ? null : Math.round(q.change * 100) / 100;
    return { name, pct, exchangeTimestamp: q.exchangeTimestamp,
      category: pct === null ? 'unavailable' : pct >= .5 ? 'green' : pct <= -.5 ? 'red' : 'neutral' };
  });
  return { version: 1, source: 'SERVER_BACKGROUND_KITE_QUOTES', timestamp: now.toISOString(),
    tradingDate: indianTradingDateAt(now), stocks, sectors };
}
export type BackgroundQuotes = ReturnType<typeof buildBackgroundQuotes>;
export function backgroundQuoteFreshness(snapshot: BackgroundQuotes | null, now: Date) {
  const ageMs = snapshot ? now.getTime() - Date.parse(snapshot.timestamp) : NaN;
  return snapshot && snapshot.tradingDate === indianTradingDateAt(now) && ageMs >= 0 && ageMs <= 6 * 60_000
    ? 'RECENT_RECEIPT' : snapshot ? 'STALE' : 'UNAVAILABLE';
}
export interface BackgroundQuoteDependencies {
  now(): Date;
  authority(): Promise<{ accessToken: string; expiresAt: number } | null>;
  fetchQuotes(token: string, symbols: string[]): Promise<QuoteMap>;
  persist(snapshot: BackgroundQuotes): Promise<boolean>;
}
// No browser, cookie or HTTP-request dependency. One bounded batch per three
// minutes, one minute retry after failure, and no overlapping upstream calls.
export class DashboardBackgroundQuoteCollector {
  snapshot: BackgroundQuotes | null = null;
  status = 'STARTING';
  lastAttemptAt: string | null = null;
  private dueAt = 0;
  private busy = false;
  constructor(private deps: BackgroundQuoteDependencies) {}
  async tick(): Promise<void> {
    const now = this.deps.now();
    if (!isIndianEquityMarketOpenAt(now)) { this.status = 'MARKET_CLOSED'; return; }
    if (this.busy || now.getTime() < this.dueAt) return;
    this.busy = true;
    this.lastAttemptAt = now.toISOString();
    this.dueAt = now.getTime() + 60_000;
    try {
      const authority = await this.deps.authority();
      if (!authority || authority.expiresAt <= this.deps.now().getTime()) {
        this.status = 'KITE_RECONNECT_REQUIRED'; return;
      }
      const quotes = await this.deps.fetchQuotes(authority.accessToken, QUOTE_SYMBOLS);
      if (!QUOTE_SYMBOLS.some(symbol => observation(quotes[symbol]).change !== null)) {
        this.status = 'QUOTES_UNAVAILABLE'; return;
      }
      const snapshot = buildBackgroundQuotes(quotes, this.deps.now());
      this.snapshot = snapshot;
      const saved = await this.deps.persist(snapshot);
      this.status = saved ? 'RECORDING' : 'STORAGE_UNAVAILABLE';
      this.dueAt = now.getTime() + (saved ? 180_000 : 60_000);
    } catch {
      // Never expose broker errors (which can contain credentials) to readers.
      this.status = 'COLLECTION_FAILED';
    } finally { this.busy = false; }
  }
}
