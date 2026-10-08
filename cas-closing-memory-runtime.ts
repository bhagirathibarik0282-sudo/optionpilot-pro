import { initializeIntradayObservationRuntime, captureIntradayObservationMemory } from "./intraday-observation-memory-runtime.js";
import { dbIsConfigured, dbQuerySafe, dbSaveCasMemoryOnce } from './db.js';
import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { runH1ReplayHttp } from './h1-replay-http.js';
import { indianTradingDateAt } from './market-session-calendar.js';
import { CAS_MEMORY_KIND, buildCasClosingMemory, isCasTradingDate, summarizeCasMemory, type CasClosingMemory } from './cas-closing-memory.js';

const runtime = { started: false, running: false, lastStartedAt: null as string | null, lastCompletedAt: null as string | null,
  lastError: null as string | null, written: 0, skippedExisting: 0, nextRunAt: null as string | null };
export function nextCasRunAt(now: Date): Date | null {
  const date = indianTradingDateAt(now), start = new Date(date + 'T15:35:00+05:30').getTime();
  for (let day = 0; day < 370; day++) {
    const candidate = new Date(start + day * 86400000), d = indianTradingDateAt(candidate);
    if (!d.startsWith('2026-')) return null; // Existing holiday calendar needs review before another year.
    if (candidate > now && isCasTradingDate(d)) return candidate;
  }
  return null;
}
export async function loadCasClosingMemories(): Promise<CasClosingMemory[]> {
  if (!dbIsConfigured()) throw new Error('CAS_MEMORY_DATABASE_UNAVAILABLE');
  const result = await dbQuerySafe<{ payload: CasClosingMemory }>(
    'SELECT payload FROM app_state_log WHERE kind=$1 ORDER BY created_at DESC, id DESC LIMIT 1500', [CAS_MEMORY_KIND]);
  if (!result) throw new Error('CAS_MEMORY_READ_FAILED');
  // Defensive de-duplication also protects summaries if an old deployment wrote duplicates.
  const unique = new Map<string, CasClosingMemory>();
  for (const { payload } of result.rows) if (payload?.version === CAS_MEMORY_KIND && !unique.has(payload.memoryKey)) unique.set(payload.memoryKey, payload);
  return [...unique.values()].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || a.symbol.localeCompare(b.symbol));
}
export async function runCasClosingMemoryCapture(now = new Date()) {
  if (runtime.running) return;
  runtime.running = true; runtime.lastStartedAt = now.toISOString(); runtime.lastError = null;
  try {
    const existing = new Set((await loadCasClosingMemories()).map(m => m.memoryKey));
    const index = await listH1TheoryRecordedDates();
    if (!index.ok) throw new Error('CAS_RECORDED_DATE_INDEX_FAILED');
    const today = indianTradingDateAt(now);
    // One bounded recovery batch from the existing recorder; no broker calls or new snapshots.
    const jobs = index.dates.filter(d => isCasTradingDate(d.tradeDate) && (d.tradeDate < today ||
      (d.tradeDate === today && now.getTime() >= Date.parse(today + 'T15:35:00+05:30')))).slice(0, 60);
    for (const job of jobs) {
      const key = `${CAS_MEMORY_KIND}/${job.tradeDate}/${job.symbol}`;
      if (existing.has(key)) { runtime.skippedExisting++; continue; }
      const replay = await runH1ReplayHttp({ symbol: job.symbol, tradeDate: job.tradeDate, fromTime: '15:00', toTime: '15:30', scope: 'CORE' });
      const memory = buildCasClosingMemory(job.tradeDate, job.symbol, replay, now);
      if (await dbSaveCasMemoryOnce(memory)) runtime.written++;
      else runtime.skippedExisting++;
      existing.add(key);
      // Release the event loop between sessions; only compact summaries are retained.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    runtime.lastCompletedAt = new Date().toISOString();
  } catch {
    runtime.lastError = 'CAS_MEMORY_CAPTURE_FAILED';
    console.error('[CAS_MEMORY] capture failed; retry is bounded, trading path unaffected');
  } finally { runtime.running = false; }
}
export function casClosingMemoryRuntimeStatus() { return { ...runtime, schedule: '15:35 IST trading days; startup recovery of recorded closed sessions',
  source: 'EXISTING_RECORDED_DATA', additionalMarketDataFetches: false, maximumRecoverySessions: 60 }; }
export function startCasClosingMemoryRuntime() {
  if (runtime.started || process.env.NODE_ENV === 'test') return;
  runtime.started = true;
  initializeIntradayObservationRuntime();
  const schedule = (attempt = 0) => {
    const now = new Date(), next = nextCasRunAt(now);
    const retry = runtime.lastError && attempt < 2 && isCasTradingDate(indianTradingDateAt(now)) &&
      now.getTime() >= Date.parse(indianTradingDateAt(now) + 'T15:35:00+05:30') &&
      now.getTime() < Date.parse(indianTradingDateAt(now) + 'T20:20:00+05:30');
    const target = retry ? new Date(now.getTime() + 5 * 60000) : next;
    runtime.nextRunAt = target?.toISOString() ?? null;
    if (target) setTimeout(() => { void runCasClosingMemoryCapture().then(() => captureIntradayObservationMemory(new Date(), true)).finally(() => schedule(retry ? attempt + 1 : 0)); }, target.getTime() - now.getTime()).unref();
  };
  // This begins only after DB initialization and HTTP listening; it never blocks boot.
  void runCasClosingMemoryCapture().finally(() => schedule());
}
export async function getCasClosingMemoryView() {
  const memories = await loadCasClosingMemories();
  return { ok: true, mode: 'READ_ONLY_CAS_CLOSING_MEMORY_V1', source: 'POSTGRES_APP_STATE_LOG',
    generatedAt: new Date().toISOString(), runtime: casClosingMemoryRuntimeStatus(), summary: summarizeCasMemory(memories), memories,
    methodology: { window: '15:15–15:30 IST', baseline: '15:00–15:15 IST (end exclusive)', minimumBaselineSamples: 2,
      minimumClosingSamples: 2, maxQuoteAgeSeconds: 60, fixedExpiryAndStrike: true, exactSnapshotIdentity: true,
      dte: 'RECORDED_CALENDAR_DAYS', averages: 'QUALIFIED_CONTRACT_DAYS_ONLY', readLimitSessions: 1500,
      caveat: 'Historical endpoint changes, not CAS causality, executable gains or a calibrated trading edge. IV values are recorded context, not independently validated.' },
    actualAuctionDataAvailable: false, affectsVerdict: false, affectsTelegram: false, affectsExecution: false };
}
