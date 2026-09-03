export type H1ExactSnapshotSource = "LIVE_RUNTIME_EXACT";
export type H1ExactSide = "CE" | "PE";

export interface H1ExactContractIdentity {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  expiryDate: string;
  strike: number;
  side: H1ExactSide;
  dte: number;
}

export interface H1ExactPriceGreekObservation extends H1ExactContractIdentity {
  source: H1ExactSnapshotSource;
  observedAt: string;
  ltp: number;
  delta: number;
  gamma: number;
  theta: number;
  iv: number;
}

export interface H1ExactDepthObservation extends H1ExactContractIdentity {
  source: H1ExactSnapshotSource;
  observedAt: string;
  receivedAt: string;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  lotQuantity: number;
}

export interface H1ExactSnapshotBundle {
  version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1";
  ready: boolean;
  identity: H1ExactContractIdentity | null;
  observedAt: string | null;
  priceGreek: H1ExactPriceGreekObservation | null;
  depth: H1ExactDepthObservation | null;
  blockers: string[];
  failClosed: true;
  semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY";
}

function ts(v: string): number | null {
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const n = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}

function validIdentity(x: H1ExactContractIdentity): boolean {
  return (x?.symbol === "NIFTY" || x?.symbol === "SENSEX" || x?.symbol === "BANKNIFTY") &&
    validDateOnly(x.expiryDate) &&
    Number.isFinite(x.strike) && x.strike > 0 &&
    (x.side === "CE" || x.side === "PE") &&
    Number.isInteger(x.dte) && x.dte >= 0;
}

function sameIdentity(a: H1ExactContractIdentity, b: H1ExactContractIdentity): boolean {
  return a.symbol === b.symbol && a.expiryDate === b.expiryDate && a.strike === b.strike && a.side === b.side && a.dte === b.dte;
}

export function aggregateH1LiveExactSnapshot(
  priceGreek: H1ExactPriceGreekObservation | null,
  depth: H1ExactDepthObservation | null,
  nowIso: string,
  maxAgeMs = 5_000,
  maxSkewMs = 2_000,
): H1ExactSnapshotBundle {
  const blockers: string[] = [];
  const now = ts(nowIso);
  if (now == null || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(maxSkewMs) || maxSkewMs < 0) blockers.push("INVALID_AGGREGATOR_POLICY_OR_NOW");
  if (!priceGreek) blockers.push("MISSING_PRICE_GREEK_OBSERVATION");
  if (!depth) blockers.push("MISSING_DEPTH_OBSERVATION");

  if (priceGreek) {
    if (priceGreek.source !== "LIVE_RUNTIME_EXACT" || !validIdentity(priceGreek) || ts(priceGreek.observedAt) == null ||
      !Number.isFinite(priceGreek.ltp) || priceGreek.ltp <= 0 || !Number.isFinite(priceGreek.delta) ||
      !Number.isFinite(priceGreek.gamma) || priceGreek.gamma < 0 || !Number.isFinite(priceGreek.theta) ||
      !Number.isFinite(priceGreek.iv) || priceGreek.iv < 0) blockers.push("INVALID_PRICE_GREEK_OBSERVATION");
  }
  if (depth) {
    if (depth.source !== "LIVE_RUNTIME_EXACT" || !validIdentity(depth) || ts(depth.observedAt) == null || ts(depth.receivedAt) == null ||
      !Number.isFinite(depth.bid) || depth.bid <= 0 || !Number.isFinite(depth.ask) || depth.ask <= depth.bid ||
      !Number.isInteger(depth.bidQty) || depth.bidQty < 0 || !Number.isInteger(depth.askQty) || depth.askQty < 0 ||
      !Number.isInteger(depth.lotQuantity) || depth.lotQuantity <= 0) blockers.push("INVALID_DEPTH_OBSERVATION");
  }

  if (priceGreek && depth && validIdentity(priceGreek) && validIdentity(depth) && !sameIdentity(priceGreek, depth)) blockers.push("CONTRACT_IDENTITY_MISMATCH");

  if (blockers.length === 0 && priceGreek && depth && now != null) {
    const pg = ts(priceGreek.observedAt)!;
    const dp = ts(depth.observedAt)!;
    const received = ts(depth.receivedAt)!;
    const agePg = now - pg;
    const ageDp = now - dp;
    if (agePg < 0 || ageDp < 0 || received > now) blockers.push("FUTURE_EVIDENCE");
    if (agePg > maxAgeMs || ageDp > maxAgeMs) blockers.push("STALE_EVIDENCE");
    if (Math.abs(pg - dp) > maxSkewMs) blockers.push("CROSS_SOURCE_TIME_SKEW_TOO_LARGE");
    if (received < dp) blockers.push("INVALID_DEPTH_RECEIVE_CHRONOLOGY");
  }

  if (blockers.length > 0 || !priceGreek || !depth) {
    return { version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", ready: false, identity: null, observedAt: null, priceGreek: null, depth: null, blockers, failClosed: true, semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY" };
  }

  const observedAt = new Date(Math.max(ts(priceGreek.observedAt)!, ts(depth.observedAt)!)).toISOString();
  return {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1",
    ready: true,
    identity: { symbol: priceGreek.symbol, expiryDate: priceGreek.expiryDate, strike: priceGreek.strike, side: priceGreek.side, dte: priceGreek.dte },
    observedAt,
    priceGreek,
    depth,
    blockers: [],
    failClosed: true,
    semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY",
  };
}
