import { createHash } from 'node:crypto';
import { deriveObservationData, resolveRecordedFullPcr } from './business-dashboard-v1-view.js';
import { iso, returnPct, dteBucket } from './cas-closing-memory.js';
import type { H1ReplayHttpResult, H1ReplaySymbol } from './h1-replay-http.js';
export const EVENT_KIND = 'INTRADAY_NOTABLE_EVENT_V1';
export const RESPONSE_KIND = 'INTRADAY_PREMIUM_RESPONSE_V1';
type Row = Record<string, any>;
export type MemoryData = { market: Row[]; options: Row[]; chain: Row[] };
const number = (v: any): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
const optionKey = (r: Row) => [r.symbol, r.expiry, r.strike, r.option_type].join('|');
const chainKey = (r: Row) => [r.symbol, r.expiry].join('|');
const gap = (a: Row, b: Row) => (Date.parse(b.minute_bucket) - Date.parse(a.minute_bucket)) / 60000;
const clean = (r: Row) => ({ ...r, minute_bucket: iso(r.minute_bucket), ...(r.expiry ? { expiry: iso(r.expiry)?.slice(0, 10) } : {}) });
export function prepareMemoryData(replay: H1ReplayHttpResult): MemoryData {
  if (!replay.ok) throw new Error('INTRADAY_REPLAY_FAILED');
  const market = (replay.market ?? []).map(clean).filter(r => r.minute_bucket && r.truth_verdict === 'TRUE');
  const byTime = new Map(market.map(r => [r.symbol + '|' + r.minute_bucket, r]));
  const options = (replay.options ?? []).map(clean).filter(r => {
    const m = byTime.get(r.symbol + '|' + r.minute_bucket), age = number(r.quote_age_seconds);
    return m && r.truth_verdict === 'TRUE' && r.snapshot_id && r.snapshot_id === m.snapshot_id &&
      age != null && age >= 0 && age <= 60 && iso(r.quote_timestamp) && number(r.ltp) != null && r.ltp > 0;
  });
  const canonical = (replay.canonical ?? []).map(clean);
  const chain = resolveRecordedFullPcr({ chain: (replay.chain ?? []).map(clean), canonical }).filter(r => {
    const m = byTime.get(r.symbol + '|' + r.minute_bucket);
    return m && r.truth_verdict === 'TRUE' && r.calculation_version === m.calculation_version;
  }).map(r => ({ ...r, full_chain_oi_pcr: ['Exact archived full-chain source', 'Normalized full-chain source'].includes(r.full_pcr_source) ? number(r.full_chain_oi_pcr) : null }));
  return { market, options, chain };
}
export function mergeMemoryData(a: MemoryData, b: MemoryData): MemoryData {
  const merge = (kind: keyof MemoryData, identity: (r: Row) => string) => [...new Map([...a[kind], ...b[kind]].map(r => [identity(r) + '|' + r.minute_bucket, r])).values()].sort((x, y) => Date.parse(x.minute_bucket) - Date.parse(y.minute_bucket));
  return { market: merge('market', r => r.symbol), options: merge('options', optionKey), chain: merge('chain', chainKey) };
}
const quote = (r: Row | undefined) => r ? { ltp: number(r.ltp), oi: number(r.oi), iv: number(r.iv), extrinsic: number(r.extrinsic), pdh: number(r.pdh), pdl: number(r.pdl),
  snapshotId: r.snapshot_id, at: r.minute_bucket, quoteAt: iso(r.quote_timestamp), quoteAgeSeconds: number(r.quote_age_seconds) } : null;
export function fixedPair(data: MemoryData, symbol: string, expiry: string, strike: number, at: string) {
  const rows = data.options.filter(r => r.symbol === symbol && r.expiry === expiry && Number(r.strike) === strike && r.minute_bucket === at);
  return { ce: quote(rows.find(r => r.option_type === 'CE')), pe: quote(rows.find(r => r.option_type === 'PE')) };
}
export interface ObservationEvent {
  version: typeof EVENT_KIND; memoryKey: string; symbol: H1ReplaySymbol; tradeDate: string; at: string; expiry: string; strike: number; dte: number | null;
  origin: 'LIVE_RECORDED_DERIVED' | 'RECOVERED_HISTORICAL'; facts: Row[]; pair: ReturnType<typeof fixedPair>;
  context: Row; previousDay: Row; affectsVerdict: false; affectsTelegram: false; affectsExecution: false;
}
export interface ObservationResponse {
  version: typeof RESPONSE_KIND; tradeDate: string; memoryKey: string; eventKey: string; symbol: H1ReplaySymbol; eventAt: string; targetAt: string; minutes: number;
  expiry: string; strike: number; status: 'QUALIFIED' | 'MISSING'; reason: string | null;
  pair: ReturnType<typeof fixedPair>; ceReturnPct: number | null; peReturnPct: number | null; straddleReturnPct: number | null;
  affectsVerdict: false; affectsTelegram: false; affectsExecution: false;
}
function briefMarket(r?: Row) { return r ? { at: r.minute_bucket, snapshotId: r.snapshot_id, spot: number(r.spot_ltp), vix: number(r.india_vix), futures: number(r.future_ltp), futuresOi: number(r.future_oi), basis: number(r.future_basis), futuresContractContinuity: 'UNVERIFIED' } : null; }
function briefChain(r?: Row) { return r ? { at: r.minute_bucket, expiry: r.expiry, fullPcr: number(r.full_chain_oi_pcr), fullPcrSource: r.full_pcr_source, ceWall: number(r.call_wall_strike), peWall: number(r.put_wall_strike), ceWallOi: number(r.call_wall_oi), peWallOi: number(r.put_wall_oi) } : null; }
export function detectObservationEvents(data: MemoryData, previous: MemoryData, symbol: H1ReplaySymbol, date: string,
  expectedPreviousDate: string | null, previousRecordedDate: string | null, origin: ObservationEvent['origin']): ObservationEvent[] {
  const start = new Date(date+'T09:15:00+05:30').toISOString(), end = new Date(date+'T15:30:00+05:30').toISOString();
  data = { market:data.market.filter(r=>r.minute_bucket>=start&&r.minute_bucket<=end), options:data.options.filter(r=>r.minute_bucket>=start&&r.minute_bucket<=end), chain:data.chain.filter(r=>r.minute_bucket>=start&&r.minute_bucket<=end) };
  const groups = new Map<string, { expiry: string; strike: number; at: string; facts: Row[] }>();
  const add = (expiry: string, strike: number, at: string, fact: Row) => {
    if (!expiry || !Number.isFinite(strike) || strike <= 0) return;
    const key = [expiry, strike, at].join('|');
    const row = groups.get(key) ?? { expiry, strike, at, facts: [] }; row.facts.push(fact); groups.set(key, row);
  };
  const anchorsAt = (at: string, expiry?: string) => data.options.filter(r => r.symbol === symbol && r.minute_bucket === at && r.option_type === 'CE' && Number(r.atm_offset) === 0 && (!expiry || r.expiry === expiry));
  const observation = deriveObservationData(data);
  for (const r of observation.breaks) if (r.symbol === symbol && r.kind === 'Observed crossing interval' && r.gapMinutes === 3) {
    add(r.expiry, Number(r.strike), r.minute_bucket, { family: 'PREMIUM_LEVEL', field: r.option_type + ' ' + r.event, from: r.previousAt, before: r.previous, after: r.ltp, level: r.level, convention: 'Observed 3-minute crossing interval; exact tick time unknown' });
  }
  for (const r of observation.wallEvents) if (r.symbol === symbol && r.gapMinutes === 3) for (const a of anchorsAt(r.minute_bucket, r.expiry)) {
    add(a.expiry, Number(a.strike), r.minute_bucket, { family: 'WALL_MIGRATION', field: r.side, from: r.previousAt, before: r.from, after: r.to, delta: r.migration, fullPcrDelta: r.pcrDelta });
  }
  // Same disclosed percentile rule as the existing dashboard: at least 8
  // EARLIER exact-cadence changes, rank >= .75 (4/5 stars). No outcome lookahead.
  const series = new Map<string, { kind: string; field: string; rows: Row[] }>();
  for (const [kind, fields] of [['market', ['spot_ltp', 'future_ltp', 'future_oi', 'future_basis', 'india_vix']], ['chain', ['full_chain_oi_pcr', 'call_wall_oi', 'put_wall_oi']], ['options', ['ltp', 'oi']]] as const) {
    for (const r of data[kind]) if (r.symbol === symbol) for (const field of fields) {
      const identity = kind === 'options' ? optionKey(r) : kind === 'chain' ? chainKey(r) : symbol;
      const k = identity + '|' + field, s = series.get(k) ?? { kind, field, rows: [] }; s.rows.push(r); series.set(k, s);
    }
  }
  for (const s of series.values()) {
    const rs = s.rows.sort((a, b) => Date.parse(a.minute_bucket) - Date.parse(b.minute_bucket)), pool: number[] = [];
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1], b = rs[i], av = number(a[s.field]), bv = number(b[s.field]);
      const wall = s.field === 'call_wall_oi' ? 'call_wall_strike' : s.field === 'put_wall_oi' ? 'put_wall_strike' : null;
      if (gap(a, b) !== 3 || av == null || bv == null || wall && (number(a[wall]) == null || a[wall] !== b[wall])) continue;
      const magnitude = Math.abs(bv - av), rank = pool.length >= 8 ? pool.filter(v => v < magnitude).length / pool.length : null;
      if (magnitude > 0 && rank != null && rank >= .75) {
        // Routine option OI/premium changes watch the current ATM pair per expiry.
        // Genuine PDH/PDL crossings above still cover all fresh recorded CORE strikes.
        const anchors = s.kind === 'options' ? Number(b.atm_offset) === 0 ? [{ expiry: b.expiry, strike: b.strike }] : [] : anchorsAt(b.minute_bucket, s.kind === 'chain' ? b.expiry : undefined);
        for (const anchor of anchors) add(anchor.expiry, Number(anchor.strike), b.minute_bucket, { family: s.kind.toUpperCase(), field: s.kind === 'options' ? b.option_type + ' ' + s.field : s.field,
          from: a.minute_bucket, before: av, after: bv, delta: bv - av, rank, earlierSamples: pool.length, stars: rank >= .9 ? 5 : 4,
          convention: 'Descriptive earlier-change percentile; not calibrated probability' });
      }
      pool.push(magnitude);
    }
  }
  return [...groups.values()].map(g => {
    const currentMarket = data.market.find(r => r.symbol === symbol && r.minute_bucket === g.at);
    const currentChain = data.chain.find(r => r.symbol === symbol && r.expiry === g.expiry && r.minute_bucket === g.at);
    const option = data.options.find(r => r.symbol === symbol && r.expiry === g.expiry && Number(r.strike) === g.strike && r.minute_bucket === g.at);
    const hash = createHash('sha256').update([EVENT_KIND, symbol, date, g.expiry, g.strike, g.at].join('|')).digest('hex');
    const close = previousRecordedDate ? new Date(previousRecordedDate + 'T15:30:00+05:30').toISOString() : '';
    return { version: EVENT_KIND, memoryKey: EVENT_KIND + '/' + hash, symbol, tradeDate: date, at: g.at, expiry: g.expiry, strike: g.strike, dte: number(option?.dte), origin,
      facts: g.facts.sort((a, b) => a.field.localeCompare(b.field)), pair: fixedPair(data, symbol, g.expiry, g.strike, g.at),
      context: { market: briefMarket(currentMarket), chain: briefChain(currentChain), peerIndices: ['NIFTY', 'SENSEX', 'BANKNIFTY'].map(peer => ({ symbol: peer, market: briefMarket(data.market.find(r => r.symbol === peer && r.minute_bucket === g.at)) })),
        ivStatus: 'RECORDED_UNVERIFIED', oiTotals: 'CORE_SUBSET_ONLY; full CE/PE aggregate totals not established' },
      previousDay: { expectedDate: expectedPreviousDate, recordedDate: previousRecordedDate, consecutiveTradingDay: expectedPreviousDate != null && expectedPreviousDate === previousRecordedDate,
        market: briefMarket(previous.market.find(r => r.symbol === symbol && r.minute_bucket === close)),
        chain: briefChain(previous.chain.find(r => r.symbol === symbol && r.expiry === g.expiry && r.minute_bucket === close)),
        sameContractPair: fixedPair(previous, symbol, g.expiry, g.strike, close), endpoint: 'EXACT_RECORDED_15:30; missing stays missing; not official settlement' },
      affectsVerdict: false, affectsTelegram: false, affectsExecution: false };
  });
}
export function buildObservationResponses(event: ObservationEvent, data: MemoryData, through: string): ObservationResponse[] {
  return [3, 15, 30].flatMap(minutes => {
    const targetAt = new Date(Date.parse(event.at) + minutes * 60000).toISOString();
    const close = Date.parse(event.tradeDate + 'T15:30:00+05:30'), outside = Date.parse(targetAt) > close;
    if (!outside && Date.parse(targetAt) > Date.parse(through)) return [];
    const pair = outside ? { ce: null, pe: null } : fixedPair(data, event.symbol, event.expiry, event.strike, targetAt);
    const baseline = event.pair.ce != null && event.pair.pe != null, endpoints = pair.ce != null && pair.pe != null;
    const expectedDte = Math.round((Date.parse(event.expiry+'T00:00:00Z')-Date.parse(event.tradeDate+'T00:00:00Z'))/86400000);
    const dteValid = dteBucket(event.dte) != null && event.dte === expectedDte;
    const candidate = !outside && baseline && endpoints && dteValid;
    const ceReturnPct = candidate ? returnPct(event.pair.ce?.ltp,pair.ce?.ltp) : null;
    const peReturnPct = candidate ? returnPct(event.pair.pe?.ltp,pair.pe?.ltp) : null;
    const straddleReturnPct = candidate ? returnPct(event.pair.ce!.ltp!+event.pair.pe!.ltp!,pair.ce!.ltp!+pair.pe!.ltp!) : null;
    const qualified = candidate && ceReturnPct != null && peReturnPct != null && straddleReturnPct != null;
    return [{ version: RESPONSE_KIND, tradeDate: event.tradeDate, memoryKey: RESPONSE_KIND + '/' + event.memoryKey.split('/').at(-1) + '/' + minutes,
      eventKey: event.memoryKey, symbol: event.symbol, eventAt: event.at, targetAt, minutes, expiry: event.expiry, strike: event.strike,
      status: qualified ? 'QUALIFIED' : 'MISSING', reason: outside ? 'OUTSIDE_SAME_SESSION' : !baseline ? 'BASELINE_PAIR_MISSING' : !endpoints ? 'EXACT_TARGET_PAIR_MISSING_OR_STALE' : !dteValid ? 'DTE_UNAVAILABLE' : !qualified ? 'INVALID_RESPONSE' : null,
      pair, ceReturnPct: qualified ? ceReturnPct : null, peReturnPct: qualified ? peReturnPct : null, straddleReturnPct: qualified ? straddleReturnPct : null,
      affectsVerdict: false, affectsTelegram: false, affectsExecution: false } as ObservationResponse];
  });
}
