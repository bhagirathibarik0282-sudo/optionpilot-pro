import type { H1ReplayHttpResult, H1ReplaySymbol } from './h1-replay-http.js';
import { indianEquityMarketPhaseAt } from './market-session-calendar.js';

export const CAS_MEMORY_KIND = 'CAS_CLOSING_FIXED_CONTRACT_MEMORY_V1';
export const CAS_SYMBOLS = ['NIFTY', 'SENSEX', 'BANKNIFTY'] as const;
type Row = Record<string, unknown>;
export const iso = (value: unknown): string | null => {
  if (value == null) return null;
  const t = new Date(value instanceof Date ? value : String(value)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
const positive = (v: unknown) => { const n = num(v); return n != null && n > 0 ? n : null; };
export const returnPct = (a: unknown, b: unknown): number | null => {
  const x = positive(a), y = num(b);
  const result = x != null && y != null ? (y / x - 1) * 100 : null;
  return result != null && Number.isFinite(result) ? result : null;
};
export function dteBucket(dte: unknown): string | null {
  const n = num(dte);
  if (n == null || !Number.isInteger(n) || n < 0) return null;
  return n === 0 ? '0' : n === 1 ? '1' : n <= 4 ? '2–4' : n <= 9 ? '5–9' : '10+';
}
export function isCasTradingDate(date: string): boolean {
  if (!/^2026-\d{2}-\d{2}$/.test(date) || iso(date + 'T12:00:00+05:30')?.slice(0, 10) !== date) return false;
  return !['HOLIDAY', 'WEEKEND'].includes(indianEquityMarketPhaseAt(new Date(date + 'T12:00:00+05:30')));
}
function quote(r: Row | undefined, market: Row | undefined) {
  const age = num(r?.quote_age_seconds);
  return !!r && !!market && r.truth_verdict === 'TRUE' && age != null && age >= 0 && age <= 60
    && positive(r.ltp) != null && iso(r.quote_timestamp) != null && typeof r.snapshot_id === 'string' && r.snapshot_id.length > 0
    && r.snapshot_id === market.snapshot_id;
}
function endpoint(r: Row | undefined) {
  return r ? { ltp: num(r.ltp), quoteAgeSeconds: num(r.quote_age_seconds), quoteTimestamp: iso(r.quote_timestamp),
    snapshotId: r.snapshot_id ?? null, oi: num(r.oi), iv: num(r.iv), extrinsic: num(r.extrinsic), calculationVersion: r.calculation_version ?? null } : null;
}
export interface CasContractMemory {
  expiry: string; strike: number; dte: number | null; bucket: string | null; qualified: boolean; reason: string | null;
  ceStart: ReturnType<typeof endpoint>; ceEnd: ReturnType<typeof endpoint>; peStart: ReturnType<typeof endpoint>; peEnd: ReturnType<typeof endpoint>;
  ceReturnPct: number | null; peReturnPct: number | null; straddleReturnPct: number | null;
}
export interface CasClosingMemory {
  memoryKey: string; version: typeof CAS_MEMORY_KIND; captureOrigin: 'RECOVERED_HISTORICAL' | 'RECORDED_CLOSE_DERIVED'; tradeDate: string; symbol: H1ReplaySymbol; recordedAt: string;
  status: 'VALID' | 'PARTIAL' | 'UNAVAILABLE'; qualifiedWindow: boolean; baselineSamples: number; closingSamples: number;
  from: string; to: string; spotReturnPct: number | null; futureReturnPct: number | null; vixStart: number | null; vixEnd: number | null;
  contracts: CasContractMemory[]; missing: string[];
  affectsVerdict: false; affectsTelegram: false; affectsExecution: false; actualAuctionDataAvailable: false;
}
export function buildCasClosingMemory(date: string, symbol: H1ReplaySymbol, replay: H1ReplayHttpResult, now = new Date()): CasClosingMemory {
  if (!replay.ok) throw new Error('CAS_REPLAY_UNAVAILABLE');
  if (replay.request?.symbol !== symbol || replay.request?.tradeDate !== date) throw new Error('CAS_REPLAY_IDENTITY_MISMATCH');
  if (!CAS_SYMBOLS.includes(symbol) || !isCasTradingDate(date)) throw new Error('CAS_DATE_OR_SYMBOL_INVALID');
  const from = new Date(date + 'T15:15:00+05:30').toISOString(), to = new Date(date + 'T15:30:00+05:30').toISOString();
  const baseFrom = new Date(date + 'T15:00:00+05:30').toISOString();
  const market = new Map((replay.market ?? []).filter(r => r.symbol === symbol && r.truth_verdict === 'TRUE').map(r => [iso(r.minute_bucket), r]));
  const baselineSamples = [...market.keys()].filter(t => t != null && t >= baseFrom && t < from).length;
  const closingSamples = [...market.keys()].filter(t => t != null && t >= from && t <= to).length;
  const start = market.get(from), end = market.get(to);
  const missing = [];
  if (baselineSamples < 2) missing.push('INSUFFICIENT_BASELINE');
  if (closingSamples < 2) missing.push('INSUFFICIENT_CLOSING');
  if (!start || !end) missing.push('EXACT_MARKET_ENDPOINT_MISSING');
  else if (positive(start.spot_ltp) == null || positive(end.spot_ltp) == null) missing.push('SPOT_ENDPOINT_INVALID');
  const qualifiedWindow = missing.length === 0;
  const options = (replay.options ?? []).filter(r => r.symbol === symbol);
  const key = (r: Row) => [iso(r.expiry)?.slice(0, 10), num(r.strike), r.option_type].join('|');
  const starts = new Map(options.filter(r => iso(r.minute_bucket) === from).map(r => [key(r), r]));
  const ends = new Map(options.filter(r => iso(r.minute_bucket) === to).map(r => [key(r), r]));
  const contracts: CasContractMemory[] = [];
  for (const a of starts.values()) {
    if (a.option_type !== 'CE' || num(a.atm_offset) !== 0) continue;
    const expiry = iso(a.expiry)?.slice(0, 10), strike = positive(a.strike);
    if (!expiry || strike == null) continue;
    const b = ends.get(key(a)), c = starts.get([expiry, strike, 'PE'].join('|')), d = ends.get([expiry, strike, 'PE'].join('|'));
    const fresh = quote(a, start) && quote(b, end) && quote(c, start) && quote(d, end);
    const expectedDte = Math.round((Date.parse(expiry + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
    const bucket = num(a.dte) === expectedDte ? dteBucket(a.dte) : null;
    const ceReturnPct = fresh ? returnPct(a.ltp, b?.ltp) : null;
    const peReturnPct = fresh ? returnPct(c?.ltp, d?.ltp) : null;
    const straddleReturnPct = fresh ? returnPct(Number(a.ltp) + Number(c?.ltp), Number(b?.ltp) + Number(d?.ltp)) : null;
    const finiteReturns = ceReturnPct != null && peReturnPct != null && straddleReturnPct != null;
    const qualified = qualifiedWindow && fresh && bucket != null && finiteReturns;
    contracts.push({ expiry, strike, dte: num(a.dte), bucket, qualified,
      reason: !fresh ? 'MISSING_STALE_OR_SNAPSHOT_MISMATCH' : !qualifiedWindow ? 'WINDOW_INCOMPLETE' : !bucket ? 'INVALID_DTE' : !finiteReturns ? 'INVALID_RETURN' : null,
      ceStart: endpoint(a), ceEnd: endpoint(b), peStart: endpoint(c), peEnd: endpoint(d),
      // Valid endpoint returns remain visible for incomplete baselines, but never enter averages.
      ceReturnPct, peReturnPct, straddleReturnPct });
  }
  return { memoryKey: `${CAS_MEMORY_KIND}/${date}/${symbol}`, version: CAS_MEMORY_KIND,
    captureOrigin: now.getTime() <= Date.parse(date + 'T20:30:00+05:30') ? 'RECORDED_CLOSE_DERIVED' : 'RECOVERED_HISTORICAL', tradeDate: date, symbol, recordedAt: now.toISOString(),
    status: qualifiedWindow ? 'VALID' : start && end ? 'PARTIAL' : 'UNAVAILABLE', qualifiedWindow, baselineSamples, closingSamples, from, to,
    spotReturnPct: start && end ? returnPct(start.spot_ltp, end.spot_ltp) : null,
    futureReturnPct: start && end ? returnPct(start.future_ltp, end.future_ltp) : null,
    vixStart: num(start?.india_vix), vixEnd: num(end?.india_vix), contracts, missing,
    affectsVerdict: false, affectsTelegram: false, affectsExecution: false, actualAuctionDataAvailable: false };
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? n % 2 ? b[Math.floor(n / 2)] : (b[n / 2 - 1] + b[n / 2]) / 2 : null; };
export function summarizeCasMemory(memories: CasClosingMemory[]) {
  const averages = [];
  for (const symbol of CAS_SYMBOLS) for (const bucket of ['0', '1', '2–4', '5–9', '10+']) {
    const samples = memories.filter(m => m.symbol === symbol && m.qualifiedWindow).flatMap(m => m.contracts.filter(c => c.qualified && c.bucket === bucket).map(c => ({ ...c, date: m.tradeDate })));
    if (!samples.length) continue;
    averages.push({ symbol, bucket, pairs: samples.length, days: new Set(samples.map(c => c.date)).size,
      meanCePct: mean(samples.map(c => c.ceReturnPct!)), meanPePct: mean(samples.map(c => c.peReturnPct!)),
      meanStraddlePct: mean(samples.map(c => c.straddleReturnPct!)), medianStraddlePct: median(samples.map(c => c.straddleReturnPct!)) });
  }
  const relationships = [];
  for (const [a, b] of [['NIFTY', 'SENSEX'], ['NIFTY', 'BANKNIFTY'], ['SENSEX', 'BANKNIFTY']]) {
    const aa = new Map(memories.filter(m => m.symbol === a && m.qualifiedWindow && m.spotReturnPct != null).map(m => [m.tradeDate, m.spotReturnPct!]));
    const pairs = memories.filter(m => m.symbol === b && m.qualifiedWindow && m.spotReturnPct != null && aa.has(m.tradeDate)).map(m => [aa.get(m.tradeDate)!, m.spotReturnPct!]);
    const ax = mean(pairs.map(p => p[0])), bx = mean(pairs.map(p => p[1]));
    const cov = ax == null || bx == null ? 0 : pairs.reduce((n, [x, y]) => n + (x - ax) * (y - bx), 0);
    const variance = ax == null || bx == null ? 0 : Math.sqrt(pairs.reduce((n, [x]) => n + (x - ax) ** 2, 0) * pairs.reduce((n, [, y]) => n + (y - bx) ** 2, 0));
    relationships.push({ pair: a + '/' + b, days: pairs.length, spotClosingReturnCorrelation: pairs.length >= 3 && variance > 0 ? cov / variance : null });
  }
  return { sessions: memories.length, qualifiedWindows: memories.filter(m => m.qualifiedWindow).length,
    qualifiedPairs: memories.reduce((n, m) => n + m.contracts.filter(c => c.qualified).length, 0), averages, relationships };
}
