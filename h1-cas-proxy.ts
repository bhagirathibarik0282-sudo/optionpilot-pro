import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";

type Row = Record<string, unknown>;
type Direction = "BULLISH" | "BEARISH" | "BALANCED" | "UNAVAILABLE";
type CasState = "DIRECTIONAL_PRESSURE_PROXY" | "MICROSTRUCTURE_DISTORTION_RISK" | "MIXED" | "BALANCED" | "UNAVAILABLE";

export interface H1CasProxyResult {
  mode: "READ_ONLY_CAS_PROXY_V1";
  classificationAuthority: "PROXY_ONLY";
  state: CasState;
  direction: Direction;
  evidenceStatus: "CONFIRMED" | "PARTIAL" | "CONFLICT" | "DATA_UNAVAILABLE";
  baselineWindowIst: "15:00-15:15";
  closingWindowIst: "15:15-15:30";
  baselineSamples: number;
  closingSamples: number;
  metrics: {
    spotChangePct: number | null;
    futureChangePct: number | null;
    futureOiChange: number | null;
    pcrChange: number | null;
    callWallShift: number | null;
    putWallShift: number | null;
    atmIvChange: number | null;
    cePremiumChangePct: number | null;
    pePremiumChangePct: number | null;
    ceVolumeChange: number | null;
    peVolumeChange: number | null;
    baselineRelativeSpread: number | null;
    closingRelativeSpread: number | null;
    spreadExpansionRatio: number | null;
    responseEfficiency: "CONFIRMED" | "FAILED_EXPECTED_RESPONSE" | "MIXED" | "UNAVAILABLE";
  };
  observed: string[];
  inferred: string[];
  missing: string[];
  nextSessionRiskMap: "BULLISH_CLOSING_PRESSURE" | "BEARISH_CLOSING_PRESSURE" | "DISTORTION_RISK" | "BALANCED_CLOSE" | "INCONCLUSIVE" | "UNAVAILABLE";
  thresholdLabel: "PROVISIONAL_HYPOTHESIS";
  fullCasReadiness: {
    indicativeClose: false;
    auctionOrderImbalance: false;
    cashAuctionVolume: false;
    ready: false;
    reason: string;
  };
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

type Point = {
  timestamp: string;
  minuteIst: number;
  market: Row;
  chain: Row | null;
  ce: Row | null;
  pe: Row | null;
};

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value)
  ? value
  : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

function pct(a: unknown, b: unknown): number | null {
  const x = finite(a); const y = finite(b);
  return x == null || y == null || x === 0 ? null : ((y - x) / Math.abs(x)) * 100;
}

function delta(a: unknown, b: unknown): number | null {
  const x = finite(a); const y = finite(b);
  return x == null || y == null ? null : y - x;
}

function relativeSpread(row: Row | null): number | null {
  if (!row) return null;
  const bid = finite(row.bid); const ask = finite(row.ask); const supplied = finite(row.spread);
  const spread = supplied ?? (bid != null && ask != null ? ask - bid : null);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : finite(row.ltp);
  return spread == null || mid == null || mid <= 0 ? null : spread / mid;
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((v): v is number => v != null);
  return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : null;
}

function istMinute(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(parsed));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function primary(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => String(a.expiry ?? "").localeCompare(String(b.expiry ?? "")));
  const expiry = sorted[0]?.expiry;
  return expiry == null ? [] : sorted.filter((row) => row.expiry === expiry);
}

function points(replay: H1ReplayHttpResult): Point[] {
  const chains = new Map<string, Row[]>(); const options = new Map<string, Row[]>();
  for (const row of replay.chain ?? []) { const key = String(row.minute_bucket ?? ""); chains.set(key, [...(chains.get(key) ?? []), row]); }
  for (const row of replay.options ?? []) { const key = String(row.minute_bucket ?? ""); options.set(key, [...(options.get(key) ?? []), row]); }
  return (replay.market ?? []).filter((row) => String(row.truth_verdict ?? "").toUpperCase() === "TRUE").flatMap((market) => {
    const timestamp = String(market.minute_bucket ?? ""); const minuteIst = istMinute(timestamp);
    if (minuteIst == null) return [];
    const chain = primary(chains.get(timestamp) ?? [])[0] ?? null;
    const atm = primary(options.get(timestamp) ?? []).filter((row) => finite(row.atm_offset) === 0);
    return [{ timestamp, minuteIst, market, chain, ce: atm.find((row) => String(row.option_type).toUpperCase() === "CE") ?? null, pe: atm.find((row) => String(row.option_type).toUpperCase() === "PE") ?? null }];
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function unavailable(): H1CasProxyResult {
  return {
    mode: "READ_ONLY_CAS_PROXY_V1", classificationAuthority: "PROXY_ONLY", state: "UNAVAILABLE", direction: "UNAVAILABLE", evidenceStatus: "DATA_UNAVAILABLE",
    baselineWindowIst: "15:00-15:15", closingWindowIst: "15:15-15:30", baselineSamples: 0, closingSamples: 0,
    metrics: { spotChangePct: null, futureChangePct: null, futureOiChange: null, pcrChange: null, callWallShift: null, putWallShift: null, atmIvChange: null, cePremiumChangePct: null, pePremiumChangePct: null, ceVolumeChange: null, peVolumeChange: null, baselineRelativeSpread: null, closingRelativeSpread: null, spreadExpansionRatio: null, responseEfficiency: "UNAVAILABLE" },
    observed: [], inferred: [], missing: ["VERIFIED_15_00_TO_15_30_ROWS", "INDICATIVE_CLOSE", "AUCTION_ORDER_IMBALANCE", "CASH_AUCTION_VOLUME"], nextSessionRiskMap: "UNAVAILABLE", thresholdLabel: "PROVISIONAL_HYPOTHESIS",
    fullCasReadiness: { indicativeClose: false, auctionOrderImbalance: false, cashAuctionVolume: false, ready: false, reason: "The recorder has continuous-market proxies, not exchange closing-auction fields." },
    affectsVerdict: false, affectsTelegram: false, affectsExecution: false,
  };
}

export function analyzeH1CasProxy(_request: H1ReplayRequest, replay: H1ReplayHttpResult): H1CasProxyResult {
  const all = points(replay);
  const baseline = all.filter((p) => p.minuteIst >= 15 * 60 && p.minuteIst < 15 * 60 + 15);
  const closing = all.filter((p) => p.minuteIst >= 15 * 60 + 15 && p.minuteIst <= 15 * 60 + 30);
  if (!replay.ok || baseline.length < 2 || closing.length < 2) return unavailable();
  const first = closing[0]; const last = closing[closing.length - 1];
  const spotChangePct = pct(first.market.spot_ltp, last.market.spot_ltp);
  const futureChangePct = pct(first.market.future_ltp, last.market.future_ltp);
  const direction: Direction = spotChangePct == null ? "UNAVAILABLE" : Math.abs(spotChangePct) < 0.01 ? "BALANCED" : spotChangePct > 0 ? "BULLISH" : "BEARISH";
  const cePremiumChangePct = pct(first.ce?.ltp, last.ce?.ltp); const pePremiumChangePct = pct(first.pe?.ltp, last.pe?.ltp);
  const favored = direction === "BULLISH" ? cePremiumChangePct : direction === "BEARISH" ? pePremiumChangePct : null;
  const opposite = direction === "BULLISH" ? pePremiumChangePct : direction === "BEARISH" ? cePremiumChangePct : null;
  const responseEfficiency = favored == null || opposite == null ? "UNAVAILABLE" : favored > 0 && opposite < 0 ? "CONFIRMED" : favored <= 0 || opposite >= favored ? "FAILED_EXPECTED_RESPONSE" : "MIXED";
  const baselineRelativeSpread = average(baseline.flatMap((p) => [relativeSpread(p.ce), relativeSpread(p.pe)]));
  const closingRelativeSpread = average(closing.flatMap((p) => [relativeSpread(p.ce), relativeSpread(p.pe)]));
  const spreadExpansionRatio = baselineRelativeSpread != null && baselineRelativeSpread > 0 && closingRelativeSpread != null ? closingRelativeSpread / baselineRelativeSpread : null;
  const futuresAligned = direction !== "UNAVAILABLE" && direction !== "BALANCED" && ((direction === "BULLISH" && (futureChangePct ?? 0) > 0) || (direction === "BEARISH" && (futureChangePct ?? 0) < 0));
  const distorted = (spreadExpansionRatio ?? 0) >= 2 && (!futuresAligned || responseEfficiency === "FAILED_EXPECTED_RESPONSE");
  const directional = futuresAligned && responseEfficiency === "CONFIRMED" && !distorted;
  const state: CasState = distorted ? "MICROSTRUCTURE_DISTORTION_RISK" : directional ? "DIRECTIONAL_PRESSURE_PROXY" : direction === "BALANCED" ? "BALANCED" : "MIXED";
  const evidenceStatus = distorted ? "CONFLICT" : directional ? "CONFIRMED" : "PARTIAL";
  const metrics = {
    spotChangePct, futureChangePct, futureOiChange: delta(first.market.future_oi, last.market.future_oi),
    pcrChange: delta(first.chain?.band7_oi_pcr ?? first.chain?.full_chain_oi_pcr, last.chain?.band7_oi_pcr ?? last.chain?.full_chain_oi_pcr),
    callWallShift: delta(first.chain?.call_wall_strike, last.chain?.call_wall_strike), putWallShift: delta(first.chain?.put_wall_strike, last.chain?.put_wall_strike), atmIvChange: delta(first.chain?.atm_iv, last.chain?.atm_iv),
    cePremiumChangePct, pePremiumChangePct, ceVolumeChange: delta(first.ce?.volume, last.ce?.volume), peVolumeChange: delta(first.pe?.volume, last.pe?.volume), baselineRelativeSpread, closingRelativeSpread, spreadExpansionRatio, responseEfficiency,
  };
  const observed = [
    `Closing spot change ${spotChangePct?.toFixed(3) ?? "NA"}%`, `Closing futures change ${futureChangePct?.toFixed(3) ?? "NA"}%`,
    `ATM CE/PE change ${cePremiumChangePct?.toFixed(2) ?? "NA"}%/${pePremiumChangePct?.toFixed(2) ?? "NA"}%`, `Relative spread expansion ${spreadExpansionRatio?.toFixed(2) ?? "NA"}x`,
  ];
  const inferred = state === "DIRECTIONAL_PRESSURE_PROXY" ? [`${direction} closing pressure proxy; requires forward validation.`] : state === "MICROSTRUCTURE_DISTORTION_RISK" ? ["Closing quotes show provisional distortion risk; do not infer directional conviction."] : ["Closing evidence is not sufficiently aligned for a directional pressure label."];
  const missing = ["INDICATIVE_CLOSE", "AUCTION_ORDER_IMBALANCE", "CASH_AUCTION_VOLUME"];
  const nextSessionRiskMap = state === "MICROSTRUCTURE_DISTORTION_RISK" ? "DISTORTION_RISK" : state === "DIRECTIONAL_PRESSURE_PROXY" ? (direction === "BULLISH" ? "BULLISH_CLOSING_PRESSURE" : "BEARISH_CLOSING_PRESSURE") : state === "BALANCED" ? "BALANCED_CLOSE" : "INCONCLUSIVE";
  return { mode: "READ_ONLY_CAS_PROXY_V1", classificationAuthority: "PROXY_ONLY", state, direction, evidenceStatus, baselineWindowIst: "15:00-15:15", closingWindowIst: "15:15-15:30", baselineSamples: baseline.length, closingSamples: closing.length, metrics, observed, inferred, missing, nextSessionRiskMap, thresholdLabel: "PROVISIONAL_HYPOTHESIS", fullCasReadiness: { indicativeClose: false, auctionOrderImbalance: false, cashAuctionVolume: false, ready: false, reason: "The recorder has continuous-market proxies, not exchange closing-auction fields." }, affectsVerdict: false, affectsTelegram: false, affectsExecution: false };
}
