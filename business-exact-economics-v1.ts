import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";

export const BUSINESS_EXACT_ECONOMICS_V1 = "BUSINESS_EXACT_ECONOMICS_V1" as const;

export interface BusinessExactEconomicsResult {
  version: typeof BUSINESS_EXACT_ECONOMICS_V1;
  ready: boolean;
  candidateKey: string | null;
  observedAt: string | null;
  premiumMovePct: number | null;
  thetaBurdenPctOfPremium: number | null;
  relativeSpreadPct: number | null;
  bidDepthCoverageMultiple: number | null;
  askDepthCoverageMultiple: number | null;
  depthImbalance: number | null;
  microprice: number | null;
  midprice: number | null;
  micropricePressure: number | null;
  blockers: string[];
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  semantics: "RESEARCH_SHADOW_ONLY" as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

function sameIdentity(a: H1ExactSnapshotBundle, b: H1ExactSnapshotBundle): boolean {
  return !!a.identity && !!b.identity &&
    a.identity.symbol === b.identity.symbol &&
    a.identity.expiryDate === b.identity.expiryDate &&
    a.identity.strike === b.identity.strike &&
    a.identity.side === b.identity.side &&
    a.identity.dte === b.identity.dte;
}

function blocked(blockers: string[]): BusinessExactEconomicsResult {
  return {
    version: BUSINESS_EXACT_ECONOMICS_V1,
    ready: false,
    candidateKey: null,
    observedAt: null,
    premiumMovePct: null,
    thetaBurdenPctOfPremium: null,
    relativeSpreadPct: null,
    bidDepthCoverageMultiple: null,
    askDepthCoverageMultiple: null,
    depthImbalance: null,
    microprice: null,
    midprice: null,
    micropricePressure: null,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

/**
 * Converts two exact same-contract live bundles into raw option-buying business
 * economics. No arbitrary 0..100 score, no candidate ranking, no direction.
 */
export function buildBusinessExactEconomics(
  previous: H1ExactSnapshotBundle,
  current: H1ExactSnapshotBundle,
): BusinessExactEconomicsResult {
  const blockers: string[] = [];
  if (!previous?.ready || !previous.identity || !previous.priceGreek || !previous.depth) blockers.push("PREVIOUS_EXACT_BUNDLE_NOT_READY");
  if (!current?.ready || !current.identity || !current.priceGreek || !current.depth) blockers.push("CURRENT_EXACT_BUNDLE_NOT_READY");
  if (blockers.length === 0 && !sameIdentity(previous, current)) blockers.push("CONTRACT_IDENTITY_MISMATCH");

  if (blockers.length === 0) {
    const p = Date.parse(previous.observedAt!);
    const c = Date.parse(current.observedAt!);
    if (!Number.isFinite(p) || !Number.isFinite(c) || c <= p) blockers.push("NON_FORWARD_CHRONOLOGY");
  }

  if (blockers.length > 0) return blocked(blockers);

  const prevPg = previous.priceGreek!;
  const pg = current.priceGreek!;
  const d = current.depth!;
  const premiumMovePct = ((pg.ltp - prevPg.ltp) / prevPg.ltp) * 100;
  const thetaBurdenPctOfPremium = Math.abs(pg.theta) / pg.ltp * 100;
  const midprice = (d.bid + d.ask) / 2;
  const relativeSpreadPct = ((d.ask - d.bid) / midprice) * 100;
  const bidDepthCoverageMultiple = d.bidQty / d.lotQuantity;
  const askDepthCoverageMultiple = d.askQty / d.lotQuantity;
  const depthDenom = d.bidQty + d.askQty;
  const depthImbalance = depthDenom > 0 ? (d.bidQty - d.askQty) / depthDenom : 0;

  // Standard queue-weighted microprice using best bid/ask quantities.
  const microprice = depthDenom > 0
    ? (d.ask * d.bidQty + d.bid * d.askQty) / depthDenom
    : midprice;
  const micropricePressure = microprice - midprice;

  const id = current.identity!;
  return {
    version: BUSINESS_EXACT_ECONOMICS_V1,
    ready: true,
    candidateKey: [id.symbol, id.side, id.strike, id.expiryDate, `DTE${id.dte}`].join(":"),
    observedAt: current.observedAt,
    premiumMovePct: round4(premiumMovePct),
    thetaBurdenPctOfPremium: round4(thetaBurdenPctOfPremium),
    relativeSpreadPct: round4(relativeSpreadPct),
    bidDepthCoverageMultiple: round4(bidDepthCoverageMultiple),
    askDepthCoverageMultiple: round4(askDepthCoverageMultiple),
    depthImbalance: round4(depthImbalance),
    microprice: round4(microprice),
    midprice: round4(midprice),
    micropricePressure: round4(micropricePressure),
    blockers: [],
    ...SAFETY,
  };
}
