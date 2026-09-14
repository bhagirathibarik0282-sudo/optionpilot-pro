import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";
import type { H1ExactWeightedHeavyweightFact } from "./h1-exact-weighted-heavyweight-live-adapter.js";
import type { H1ExactDirectionalFamilyEvidence, H1RemainingDirectionalFamily } from "./h1-remaining-family-directional-attestor.js";

export const H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1 = "H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1" as const;

type Direction = "UP" | "DOWN";
type Common = {
  provenance: "LIVE_RUNTIME_EXACT";
  symbol: CanonicalMarketSymbol;
  observedAtMs: number;
  sourceId: string;
  devilFlags: string[];
};

export interface H1LiveSevenFamilyFacts {
  marketStructure: Common & { spotMovePct: number; spotPivotAccepted: boolean; structureHoldSamples: number };
  futuresConfirmation: Common & { futuresMovePct: number; futuresVwapAccepted: boolean; acceptanceSamples: number };
  oiPositioning: Common & { band7PcrDelta: number; volumePcrDelta: number; wallAsymmetryPct: number };
  volatility: Common & { candidatePremiumMovePct: number; vixChangePct: number; atmIvChangePct: number };
  heavyweights: H1ExactWeightedHeavyweightFact;
  sectorBreadth: Common & { bullishCount: number; bearishCount: number; totalCount: number };
  responseLadder: Common & { direction: Direction; confirmedStages: number; totalStages: 4 };
}

export interface H1LiveSevenFamilyPolicy {
  minSpotMovePct: number;
  requiredStructureHoldSamples: number;
  minFuturesMovePct: number;
  requiredFuturesAcceptanceSamples: number;
  minBand7PcrDelta: number;
  minVolumePcrDelta: number;
  minWallAsymmetryPct: number;
  minCandidatePremiumMovePct: number;
  minVolExpansionPct: number;
  minHeavyweightDirectionalMarginPct: number;
  minSectorDirectionalSharePct: number;
  requiredResponseStages: number;
  maxAgeMs: number;
}

export interface H1LiveSevenFamilyDirectionalProducerResult {
  version: typeof H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1;
  ready: boolean;
  evidence: H1ExactDirectionalFamilyEvidence[];
  blockers: string[];
  scoreMeaning: "DETERMINISTIC_POLICY_ALIGNMENT_NOT_PROBABILITY_NOT_WIN_RATE";
  contextOnlyEvidencePromoted: false;
  optionSideInferenceUsed: false;
  calibratedProbabilityClaimed: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const safety = {
  scoreMeaning: "DETERMINISTIC_POLICY_ALIGNMENT_NOT_PROBABILITY_NOT_WIN_RATE" as const,
  contextOnlyEvidencePromoted: false as const,
  optionSideInferenceUsed: false as const,
  calibratedProbabilityClaimed: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  failClosed: true as const,
};

function blocked(blockers: string[]): H1LiveSevenFamilyDirectionalProducerResult {
  return { version: H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1, ready: false, evidence: [], blockers: [...new Set(blockers)], ...safety };
}

function validPolicy(p: H1LiveSevenFamilyPolicy): boolean {
  return Boolean(p
    && Number.isFinite(p.minSpotMovePct) && p.minSpotMovePct > 0
    && Number.isInteger(p.requiredStructureHoldSamples) && p.requiredStructureHoldSamples > 0
    && Number.isFinite(p.minFuturesMovePct) && p.minFuturesMovePct > 0
    && Number.isInteger(p.requiredFuturesAcceptanceSamples) && p.requiredFuturesAcceptanceSamples > 0
    && Number.isFinite(p.minBand7PcrDelta) && p.minBand7PcrDelta > 0
    && Number.isFinite(p.minVolumePcrDelta) && p.minVolumePcrDelta > 0
    && Number.isFinite(p.minWallAsymmetryPct) && p.minWallAsymmetryPct > 0
    && Number.isFinite(p.minCandidatePremiumMovePct) && p.minCandidatePremiumMovePct > 0
    && Number.isFinite(p.minVolExpansionPct) && p.minVolExpansionPct >= 0
    && Number.isFinite(p.minHeavyweightDirectionalMarginPct) && p.minHeavyweightDirectionalMarginPct > 0
    && Number.isFinite(p.minSectorDirectionalSharePct) && p.minSectorDirectionalSharePct > 50 && p.minSectorDirectionalSharePct <= 100
    && Number.isInteger(p.requiredResponseStages) && p.requiredResponseStages >= 1 && p.requiredResponseStages <= 4
    && Number.isFinite(p.maxAgeMs) && p.maxAgeMs > 0);
}

function finite(...values: number[]): boolean { return values.every((v) => Number.isFinite(v)); }
function cap(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function ratio(value: number, threshold: number): number { return cap(Math.abs(value) / threshold * 50); }
function signed(value: number, direction: Direction): number { return direction === "UP" ? value : -value; }

function validCommon(row: Common, symbol: CanonicalMarketSymbol, nowMs: number, maxAgeMs: number): boolean {
  const age = nowMs - row?.observedAtMs;
  return Boolean(row
    && row.provenance === "LIVE_RUNTIME_EXACT"
    && row.symbol === symbol
    && Number.isFinite(row.observedAtMs) && row.observedAtMs > 0
    && age >= 0 && age <= maxAgeMs
    && typeof row.sourceId === "string" && row.sourceId.trim()
    && Array.isArray(row.devilFlags) && row.devilFlags.length === 0);
}

function exactDirection(source: H1ExactLiveSpotDirectionResult): Direction | null {
  return source?.ready === true
    && source.source === "VERIFIED_DETERMINISTIC_RUNTIME"
    && source.sourceId === "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1"
    && source.liveRuntimeExact === true
    && source.deterministic === true
    && source.blockers.length === 0
    && (source.direction === "UP" || source.direction === "DOWN")
    ? source.direction : null;
}

function evidence(
  family: H1RemainingDirectionalFamily,
  common: Common,
  direction: Direction,
  strength: number,
  manifest: string,
): H1ExactDirectionalFamilyEvidence {
  return {
    provenance: "LIVE_RUNTIME_EXACT_DIRECTIONAL_FAMILY_V1",
    family, symbol: common.symbol, direction, strength: cap(strength),
    observedAtMs: common.observedAtMs, sourceId: common.sourceId,
    sourceManifestHash: manifest, deterministic: true, evidenceReady: true,
    grantsDirectionalSupport: true, contextOnly: false, devilFlags: [],
  };
}

/**
 * Produces the seven remaining live family contracts from exact numeric facts.
 * Every family must independently pass its explicit policy in the same direction.
 * The 0..100 value measures distance/alignment against policy thresholds only.
 */
export function produceH1LiveSevenDirectionalFamilies(input: {
  symbol: CanonicalMarketSymbol;
  directionSource: H1ExactLiveSpotDirectionResult;
  facts: H1LiveSevenFamilyFacts;
  policy: H1LiveSevenFamilyPolicy;
  sourceManifestHash: string;
  nowMs: number;
}): H1LiveSevenFamilyDirectionalProducerResult {
  const blockers: string[] = [];
  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(input?.symbol)) blockers.push("INVALID_SYMBOL");
  if (!validPolicy(input?.policy)) blockers.push("INVALID_SEVEN_FAMILY_POLICY");
  if (typeof input?.sourceManifestHash !== "string" || !input.sourceManifestHash.trim()) blockers.push("INVALID_SOURCE_MANIFEST");
  if (!Number.isFinite(input?.nowMs) || input.nowMs <= 0) blockers.push("INVALID_NOW");
  const direction = exactDirection(input?.directionSource);
  if (!direction) blockers.push("INDEPENDENT_EXACT_DIRECTION_NOT_READY");
  if (blockers.length) return blocked(blockers);

  const { facts, policy } = input;
  const rows: Array<[H1RemainingDirectionalFamily, Common]> = [
    ["MARKET_STRUCTURE", facts?.marketStructure],
    ["FUTURES_CONFIRMATION", facts?.futuresConfirmation],
    ["OI_POSITIONING", facts?.oiPositioning],
    ["VOLATILITY", facts?.volatility],
    ["HEAVYWEIGHTS", facts?.heavyweights],
    ["SECTOR_BREADTH", facts?.sectorBreadth],
    ["RESPONSE_LADDER", facts?.responseLadder],
  ];
  for (const [family, row] of rows) {
    if (!validCommon(row, input.symbol, input.nowMs, policy.maxAgeMs)) blockers.push(`${family}:EXACT_FACT_INVALID_STALE_OR_FLAGGED`);
  }
  if (blockers.length) return blocked(blockers);

  const out: H1ExactDirectionalFamilyEvidence[] = [];
  const ms = facts.marketStructure;
  const msMove = signed(ms.spotMovePct, direction!);
  if (!finite(msMove) || msMove < policy.minSpotMovePct || !ms.spotPivotAccepted || ms.structureHoldSamples < policy.requiredStructureHoldSamples) {
    blockers.push("MARKET_STRUCTURE:POLICY_NOT_CONFIRMED");
  } else out.push(evidence("MARKET_STRUCTURE", ms, direction!, (ratio(msMove, policy.minSpotMovePct) + cap(ms.structureHoldSamples / policy.requiredStructureHoldSamples * 50)) / 2, input.sourceManifestHash));

  const fu = facts.futuresConfirmation;
  const fuMove = signed(fu.futuresMovePct, direction!);
  if (!finite(fuMove) || fuMove < policy.minFuturesMovePct || !fu.futuresVwapAccepted || fu.acceptanceSamples < policy.requiredFuturesAcceptanceSamples) {
    blockers.push("FUTURES_CONFIRMATION:POLICY_NOT_CONFIRMED");
  } else out.push(evidence("FUTURES_CONFIRMATION", fu, direction!, (ratio(fuMove, policy.minFuturesMovePct) + cap(fu.acceptanceSamples / policy.requiredFuturesAcceptanceSamples * 50)) / 2, input.sourceManifestHash));

  const oi = facts.oiPositioning;
  const oiValues = [signed(oi.band7PcrDelta, direction!), signed(oi.volumePcrDelta, direction!), signed(oi.wallAsymmetryPct, direction!)];
  const oiThresholds = [policy.minBand7PcrDelta, policy.minVolumePcrDelta, policy.minWallAsymmetryPct];
  if (!finite(...oiValues) || oiValues.some((v, i) => v < oiThresholds[i])) blockers.push("OI_POSITIONING:POLICY_NOT_CONFIRMED");
  else out.push(evidence("OI_POSITIONING", oi, direction!, oiValues.reduce((s, v, i) => s + ratio(v, oiThresholds[i]), 0) / 3, input.sourceManifestHash));

  const vol = facts.volatility;
  const volExpansion = Math.max(vol.vixChangePct, vol.atmIvChangePct);
  if (!finite(vol.candidatePremiumMovePct, volExpansion) || vol.candidatePremiumMovePct < policy.minCandidatePremiumMovePct || volExpansion < policy.minVolExpansionPct) {
    blockers.push("VOLATILITY:BUYER_EXPANSION_NOT_CONFIRMED");
  } else out.push(evidence("VOLATILITY", vol, direction!, (ratio(vol.candidatePremiumMovePct, policy.minCandidatePremiumMovePct) + (policy.minVolExpansionPct === 0 ? 50 : ratio(volExpansion, policy.minVolExpansionPct))) / 2, input.sourceManifestHash));

  const hw = facts.heavyweights;
  const officialWeightedSource = hw?.sourceId === "H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1"
    && hw?.officialWeightAuthorityVerified === true
    && hw?.normalizedMissingWeightAway === false
    && finite(hw?.liveWeightCoveragePct)
    && hw.liveWeightCoveragePct > 0
    && hw.liveWeightCoveragePct <= 100
    && typeof hw?.referenceProviderId === "string" && hw.referenceProviderId.trim().length > 0
    && typeof hw?.referenceDocumentId === "string" && hw.referenceDocumentId.trim().length > 0
    && typeof hw?.referenceVersion === "string" && hw.referenceVersion.trim().length > 0
    && typeof hw?.referenceManifestHash === "string" && hw.referenceManifestHash.trim().length > 0;
  const hwDirectional = direction === "UP" ? hw.bullishWeightPct : hw.bearishWeightPct;
  const hwOpposite = direction === "UP" ? hw.bearishWeightPct : hw.bullishWeightPct;
  const hwMargin = hwDirectional - hwOpposite;
  if (!officialWeightedSource) blockers.push("HEAVYWEIGHTS:OFFICIAL_WEIGHTED_SOURCE_REQUIRED");
  else if (!finite(hwDirectional, hwOpposite) || hwDirectional < 0 || hwOpposite < 0 || hwMargin < policy.minHeavyweightDirectionalMarginPct) blockers.push("HEAVYWEIGHTS:POLICY_NOT_CONFIRMED");
  else out.push(evidence("HEAVYWEIGHTS", hw, direction!, ratio(hwMargin, policy.minHeavyweightDirectionalMarginPct), input.sourceManifestHash));

  const se = facts.sectorBreadth;
  const directionalCount = direction === "UP" ? se.bullishCount : se.bearishCount;
  const sectorShare = se.totalCount > 0 ? directionalCount / se.totalCount * 100 : NaN;
  if (!Number.isInteger(se.bullishCount) || !Number.isInteger(se.bearishCount) || !Number.isInteger(se.totalCount) || se.totalCount <= 0 || se.bullishCount + se.bearishCount > se.totalCount || sectorShare < policy.minSectorDirectionalSharePct) blockers.push("SECTOR_BREADTH:POLICY_NOT_CONFIRMED");
  else out.push(evidence("SECTOR_BREADTH", se, direction!, cap(sectorShare), input.sourceManifestHash));

  const la = facts.responseLadder;
  if (la.direction !== direction || !Number.isInteger(la.confirmedStages) || la.totalStages !== 4 || la.confirmedStages < policy.requiredResponseStages || la.confirmedStages > 4) blockers.push("RESPONSE_LADDER:POLICY_NOT_CONFIRMED");
  else out.push(evidence("RESPONSE_LADDER", la, direction!, la.confirmedStages / 4 * 100, input.sourceManifestHash));

  if (blockers.length || out.length !== 7) return blocked(blockers);
  return { version: H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1, ready: true, evidence: out, blockers: [], ...safety };
}
