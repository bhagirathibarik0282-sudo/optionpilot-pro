import { dbIsConfigured, dbQuerySafe, dbSaveResearchMemoryOnce } from './db.js';
import { runH1ReplayHttp, type H1ReplaySymbol } from './h1-replay-http.js';
import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { CAS_SYMBOLS, isCasTradingDate } from './cas-closing-memory.js';
import { indianTradingDateAt, isIndianEquityMarketOpenAt, indianEquityMarketPhaseAt } from './market-session-calendar.js';
import { EVENT_KIND, RESPONSE_KIND, prepareMemoryData, mergeMemoryData, detectObservationEvents, buildObservationResponses, type MemoryData, type ObservationEvent, type ObservationResponse } from './intraday-observation-memory.js';
export const RECEIPT_KIND = 'INTRADAY_MEMORY_SESSION_RECEIPT_V1';
const empty = (): MemoryData => ({ market: [], options: [], chain: [] });
let date = '', data = empty(), previous = empty(), previousRecorded = new Map<string, string>();
let events = new Map<string, ObservationEvent>(), responses = new Set<string>();
const cursors = new Map<string, string>();
const status = { started: false, running: false, lastCompletedAt: null as string | null, lastError: null as string | null,
  savedEvents: 0, savedResponses: 0, processedCycles: 0, captureDate: null as string | null };
const clock = (at: string) => new Date(Date.parse(at) + 19800000).toISOString().slice(11, 16);
export function expectedPreviousTradingDate(today: string): string | null {
  for (let i = 1; i <= 10; i++) { const d = new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10); if (isCasTradingDate(d)) return d; }
  return null;
}
async function stateRows<T>(kind: string, tradeDate: string): Promise<T[]> {
  const q = await dbQuerySafe<{ payload: T }>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'=$2 ORDER BY id", [kind, tradeDate]);
  if (!q) throw new Error('MEMORY_READ_FAILED'); return q.rows.map(r => r.payload);
}
async function enterDay(today: string) {
  if (date === today) return;
  const index = await listH1TheoryRecordedDates(); if (!index.ok) throw new Error('MEMORY_DATE_INDEX_FAILED');
  const nextPrevious = empty(), nextRecorded = new Map<string, string>();
  for (const symbol of CAS_SYMBOLS) {
    const prior = index.dates.find(d => d.symbol === symbol && d.tradeDate < today && isCasTradingDate(d.tradeDate));
    if (!prior) continue;
    const replay = await runH1ReplayHttp({ symbol, tradeDate: prior.tradeDate, fromTime: '15:30', toTime: '15:30', scope: 'CORE' });
    const prepared = prepareMemoryData(replay); nextPrevious.market.push(...prepared.market); nextPrevious.options.push(...prepared.options); nextPrevious.chain.push(...prepared.chain); nextRecorded.set(symbol, prior.tradeDate);
  }
  const oldEvents = await stateRows<ObservationEvent>(EVENT_KIND, today), oldResponses = await stateRows<ObservationResponse>(RESPONSE_KIND, today);
  date = today; data = empty(); previous = nextPrevious; previousRecorded = nextRecorded; cursors.clear();
  events = new Map(oldEvents.map(e => [e.memoryKey, e])); responses = new Set(oldResponses.map(r => r.memoryKey)); status.captureDate = today;
}
export async function captureIntradayObservationMemory(now = new Date(), recoverClosedSession = false) {
  if (status.running || !dbIsConfigured()) return;
  const today = indianTradingDateAt(now);
  if (!isCasTradingDate(today) || (!recoverClosedSession && !isIndianEquityMarketOpenAt(now))) return;
  if (recoverClosedSession && indianEquityMarketPhaseAt(now) !== 'POSTMARKET') return;
  status.running = true; status.lastError = null;
  try {
    await enterDay(today);
    const toTime = recoverClosedSession ? '15:30' : clock(now.toISOString());
    for (const symbol of CAS_SYMBOLS) {
      const fromTime = cursors.get(symbol) ?? '09:15';
      const replay = await runH1ReplayHttp({ symbol, tradeDate: today, fromTime, toTime, scope: 'CORE' });
      data = mergeMemoryData(data, prepareMemoryData(replay)); cursors.set(symbol, toTime);
    }
    const through = new Date(today + 'T' + toTime + ':00+05:30').toISOString();
    for (const symbol of CAS_SYMBOLS) {
      const detected = detectObservationEvents(data, previous, symbol, today, expectedPreviousTradingDate(today), previousRecorded.get(symbol) ?? null,
        recoverClosedSession ? 'RECOVERED_HISTORICAL' : 'LIVE_RECORDED_DERIVED');
      for (const event of detected) if (!events.has(event.memoryKey)) {
        if (await dbSaveResearchMemoryOnce(event)) {
          status.savedEvents++; events.set(event.memoryKey, event);
        } else {
          // A competing process may have frozen another baseline first.
          // Responses must use that persisted winner, not the local retry.
          const saved = await dbQuerySafe<{payload: ObservationEvent}>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'memoryKey'=$2 LIMIT 1", [EVENT_KIND,event.memoryKey]);
          if (!saved?.rows[0]) throw new Error('LOCKED_EVENT_READ_FAILED');
          events.set(event.memoryKey, saved.rows[0].payload);
        }
      }
    }
    for (const event of events.values()) for (const response of buildObservationResponses(event, data, through)) if (!responses.has(response.memoryKey)) {
      if (await dbSaveResearchMemoryOnce(response)) status.savedResponses++;
      responses.add(response.memoryKey);
    }
    if (toTime === '15:30') await dbSaveResearchMemoryOnce({version:RECEIPT_KIND,memoryKey:RECEIPT_KIND+'/'+today,tradeDate:today,processedThrough:through,
      recordedTrueMarketBuckets:Object.fromEntries(CAS_SYMBOLS.map(symbol=>[symbol,data.market.filter(r=>r.symbol===symbol).length])),
      source:'EXISTING_RECORDED_DATA',events:events.size,responseRecords:responses.size,completedAt:new Date().toISOString(),affectsVerdict:false,affectsTelegram:false,affectsExecution:false} as any);
    status.processedCycles++; status.lastCompletedAt = new Date().toISOString();
  } catch { status.lastError = 'INTRADAY_MEMORY_CAPTURE_FAILED'; console.error('[INTRADAY_MEMORY] capture failed; existing recorder and trading authority unaffected'); }
  finally { status.running = false; }
}
export function queueIntradayMemoryCycle() {
  if (process.env.NODE_ENV === 'test') return;
  // Existing recorder clock only: no added polling timer or market-data request.
  void captureIntradayObservationMemory();
}
export function initializeIntradayObservationRuntime() {
  if (status.started || process.env.NODE_ENV === 'test') return;
  status.started = true;
  // One latest closed recorded session plus the latest unfinished older
  // session, if any. Receipts avoid repeating full-day reads on each restart.
  void (async () => {
    const now = new Date(), today = indianTradingDateAt(now), completed = new Set<string>();
    const prior = await dbQuerySafe<{date:string; events:string}>("SELECT payload->>'tradeDate' AS date, count(*) AS events FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'<$2 GROUP BY payload->>'tradeDate' ORDER BY date DESC LIMIT 1", [EVENT_KIND,today]);
    if (prior?.rows[0]) {
      const d = prior.rows[0].date;
      const count = await dbQuerySafe<{n:string}>("SELECT count(*) AS n FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'=$2",[RESPONSE_KIND,d]);
      if (count && Number(count.rows[0]?.n) < Number(prior.rows[0].events)*3) {
        await captureIntradayObservationMemory(new Date(d+'T15:35:00+05:30'),true); completed.add(d);
      }
    }
    const index=await listH1TheoryRecordedDates();
    if (!index.ok) throw new Error('STARTUP_DATE_INDEX_UNAVAILABLE');
    const last=index.dates.find(d=>isCasTradingDate(d.tradeDate)&&(d.tradeDate<today||d.tradeDate===today&&indianEquityMarketPhaseAt(now)==='POSTMARKET'))?.tradeDate;
    if (last&&!completed.has(last)) {
      const receipt=await dbQuerySafe("SELECT id FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'=$2 LIMIT 1",[RECEIPT_KIND,last]);
      if (!receipt) throw new Error('RECEIPT_READ_FAILED');
      if (!receipt.rows.length) await captureIntradayObservationMemory(new Date(last+'T15:35:00+05:30'),true);
    }
  })().catch(() => { status.lastError='INTRADAY_MEMORY_STARTUP_RECOVERY_FAILED'; });
}
export function intradayMemoryRuntimeStatus() { return { ...status, recurringCapture: 'EXISTING_3_MINUTE_RECORDER_ONLY', additionalBrokerRequests: false,
  responseWindowsMinutes: [3, 15, 30], notableRule: 'Existing PDH/PDL crossings, wall migration, earlier-change percentile >=75% with at least 8 comparable prior samples',
  routinePremiumOiScope: 'Current recorded ATM per expiry; PDH/PDL crossings cover fresh CORE strikes', futuresContinuity: 'UNVERIFIED', iv: 'RECORDED_CONTEXT_ONLY' }; }
export async function getIntradayObservationMemory(requestedDate?: string, symbol?: H1ReplaySymbol) {
  if (!dbIsConfigured()) throw new Error('MEMORY_DB_UNAVAILABLE');
  const dates = await dbQuerySafe<{ date: string }>("SELECT DISTINCT payload->>'tradeDate' AS date FROM app_state_log WHERE kind IN ($1,$2) ORDER BY date DESC LIMIT 30", [EVENT_KIND,RECEIPT_KIND]);
  if (!dates) throw new Error('MEMORY_READ_FAILED');
  const tradeDate = requestedDate ?? dates.rows[0]?.date ?? indianTradingDateAt(new Date());
  const q = await dbQuerySafe<{ payload: ObservationEvent }>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'=$2 AND ($3::text IS NULL OR payload->>'symbol'=$3) ORDER BY payload->>'at' DESC, id DESC LIMIT 1000", [EVENT_KIND, tradeDate, symbol ?? null]);
  if (!q) throw new Error('MEMORY_READ_FAILED');
  const es = q.rows.map(r => r.payload), keys = es.map(e => e.memoryKey);
  const r = await dbQuerySafe<{ payload: ObservationResponse }>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'eventKey'=ANY($2::text[]) ORDER BY id", [RESPONSE_KIND, keys]);
  if (!r) throw new Error('MEMORY_READ_FAILED');
  const rs = r.rows.map(r => r.payload);
  const receipt=await dbQuerySafe<{payload:unknown}>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'tradeDate'=$2 LIMIT 1",[RECEIPT_KIND,tradeDate]);
  if (!receipt) throw new Error('MEMORY_RECEIPT_READ_FAILED');
  return { ok: true, mode: 'READ_ONLY_INTRADAY_OBSERVATION_MEMORY_V1', source: 'POSTGRES_APP_STATE_LOG', generatedAt: new Date().toISOString(), tradeDate,
    coverageReceipt:receipt.rows[0]?.payload??null, availableDates: dates.rows.map(r => r.date), runtime: intradayMemoryRuntimeStatus(), readLimitEvents: 1000,
    summary: { loadedEvents: es.length, qualifiedResponses: rs.filter(r => r.status === 'QUALIFIED').length, missingResponses: rs.filter(r => r.status === 'MISSING').length,
      responseRecords: rs.length, pendingResponseSlots: Math.max(0, es.length * 3 - rs.length) },
    events: es, responses: rs, affectsVerdict: false, affectsTelegram: false, affectsExecution: false,
    methodology: 'Observed sampled intervals; same expiry/strike CE+PE at exact follow-up timestamps. No nearest quote, no gap filling, no causal or trading-profit claim.' };
}
