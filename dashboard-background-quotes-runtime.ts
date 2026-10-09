import { dbQuerySafe } from './db.js';
import { resolveKiteAuthoritySession } from './kite-session-authority.js';
import { DashboardBackgroundQuoteCollector, backgroundQuoteFreshness, type BackgroundQuotes, type QuoteMap } from './dashboard-background-quotes.js';

const KIND = 'DASHBOARD_BACKGROUND_QUOTES_V1';
const collector = new DashboardBackgroundQuoteCollector({
  now: () => new Date(),
  authority: async () => (await resolveKiteAuthoritySession()).session,
  fetchQuotes: async (token, symbols) => {
    const apiKey = process.env.KITE_API_KEY?.trim();
    if (!apiKey) throw new Error('KITE_NOT_CONFIGURED');
    const url = new URL('https://api.kite.trade/quote');
    symbols.forEach(symbol => url.searchParams.append('i', symbol));
    const response = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: `token ${apiKey}:${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('QUOTE_REQUEST_FAILED');
    const body = await response.json() as { status?: string; data?: QuoteMap };
    if (body.status !== 'success' || !body.data || typeof body.data !== 'object') throw new Error('QUOTE_RESPONSE_INVALID');
    return body.data;
  },
  persist: async snapshot => (await dbQuerySafe('INSERT INTO app_state_log (kind,payload) VALUES ($1,$2::jsonb)', [KIND, JSON.stringify(snapshot)])) !== null,
});
let timer: ReturnType<typeof setInterval> | null = null;
export function startDashboardBackgroundQuotes(): void {
  if (timer || process.env.NODE_ENV === 'test') return;
  const run = async () => {
    const previous = collector.lastAttemptAt;
    await collector.tick();
    if (collector.lastAttemptAt !== previous) {
      console.log(`[DASHBOARD_BACKGROUND_QUOTES] status=${collector.status} recordedAt=${collector.snapshot?.timestamp ?? 'none'}`);
    }
  };
  timer = setInterval(() => { void run(); }, 30_000);
  timer.unref();
  void run();
}

// Reading the dashboard never causes a broker request. Only public market
// observations are returned; no account, session, token or order data.
export async function readDashboardBackgroundQuotes() {
  let snapshot = collector.snapshot;
  if (!snapshot) {
    const result = await dbQuerySafe<{ payload: BackgroundQuotes }>('SELECT payload FROM app_state_log WHERE kind=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [KIND]);
    snapshot = result?.rows[0]?.payload ?? null;
  }
  return { snapshot, status: collector.status, lastAttemptAt: collector.lastAttemptAt,
    freshness: backgroundQuoteFreshness(snapshot, new Date()),
    background: true, cadenceSeconds: 180, exchangeFreshnessVerified: false };
}
