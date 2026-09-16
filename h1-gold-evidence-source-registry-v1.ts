import type { GoldEvidenceFamily } from "./h1-gold-eligibility-v1.js";
import type { GoldExactProvenance } from "./h1-gold-evidence-adapter-v1.js";

export const H1_GOLD_EVIDENCE_SOURCE_REGISTRY_VERSION = "H1_GOLD_EVIDENCE_SOURCE_REGISTRY_V1" as const;

export interface H1GoldApprovedProducer {
  family: GoldEvidenceFamily;
  source: string;
  provenance: GoldExactProvenance;
  evidenceBasis: string;
}

/**
 * Gold producer authority is intentionally narrow. A source is listed only
 * when current repository code proves that the producer emits evidence whose
 * semantics match the Gold family. Missing registrations are deliberate and
 * must fail closed; do not add aliases merely to make a research case pass.
 */
const APPROVED_PRODUCERS: readonly H1GoldApprovedProducer[] = [
  {
    family: "dataIntegrity",
    source: "H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Typed bridge rebuilds the canonical one-roof snapshot and requires strict-filter READY, VERIFIED quality, ALLOW_NEW_ENTRIES and zero canonical blockers at the exact decision timestamp",
  },
  {
    family: "premiumPair",
    source: "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Exact same-strike CE/PE pair history across 3m/6m/15m; supporting-only controlled-expansion evidence, never a standalone trigger",
  },
  {
    family: "spotStructure",
    source: "H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Typed bridge re-runs the side-aware seven-family attestor and accepts only exact-timestamp MARKET_STRUCTURE BUYER_SUPPORT evidence",
  },
  {
    family: "targetFuturesPositioning",
    source: "H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Typed bridge re-runs the side-aware seven-family attestor and accepts only exact-timestamp FUTURES_CONFIRMATION BUYER_SUPPORT evidence",
  },
  {
    family: "leaderPositioning",
    source: "H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Typed bridge re-runs the side-aware seven-family attestor and accepts only exact-timestamp officially weighted HEAVYWEIGHTS BUYER_SUPPORT evidence",
  },
  {
    family: "chainRepositioning",
    source: "H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Typed bridge re-runs the side-aware seven-family attestor and accepts only exact-timestamp OI_POSITIONING BUYER_SUPPORT evidence",
  },
  {
    family: "executionQuality",
    source: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    evidenceBasis: "Exact bid/ask, spread, depth, capital and DTE evaluator output",
  },
] as const;

export type H1GoldProducerApprovalReason =
  | "APPROVED_GOLD_PRODUCER"
  | "NO_APPROVED_GOLD_PRODUCER_FOR_FAMILY"
  | "UNKNOWN_GOLD_EVIDENCE_SOURCE"
  | "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY"
  | "UNAPPROVED_GOLD_PROVENANCE";

export interface H1GoldProducerApproval {
  approved: boolean;
  reason: H1GoldProducerApprovalReason;
  matchedFamily: GoldEvidenceFamily | null;
  registration: H1GoldApprovedProducer | null;
}

export function listApprovedGoldProducers(family?: GoldEvidenceFamily): readonly H1GoldApprovedProducer[] {
  return family ? APPROVED_PRODUCERS.filter((entry) => entry.family === family) : [...APPROVED_PRODUCERS];
}

export function auditGoldProducer(
  family: GoldEvidenceFamily,
  source: string | null,
  provenance: GoldExactProvenance | null,
): H1GoldProducerApproval {
  const normalizedSource = source?.trim() ?? "";
  const sourceMatches = APPROVED_PRODUCERS.filter((entry) => entry.source === normalizedSource);
  const familyEntries = APPROVED_PRODUCERS.filter((entry) => entry.family === family);

  if (sourceMatches.length > 0 && !sourceMatches.some((entry) => entry.family === family)) {
    return {
      approved: false,
      reason: "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY",
      matchedFamily: sourceMatches[0]?.family ?? null,
      registration: null,
    };
  }

  if (familyEntries.length === 0) {
    return {
      approved: false,
      reason: "NO_APPROVED_GOLD_PRODUCER_FOR_FAMILY",
      matchedFamily: null,
      registration: null,
    };
  }

  if (sourceMatches.length === 0) {
    return {
      approved: false,
      reason: "UNKNOWN_GOLD_EVIDENCE_SOURCE",
      matchedFamily: null,
      registration: null,
    };
  }

  const familyMatch = sourceMatches.find((entry) => entry.family === family)!;
  if (familyMatch.provenance !== provenance) {
    return {
      approved: false,
      reason: "UNAPPROVED_GOLD_PROVENANCE",
      matchedFamily: familyMatch.family,
      registration: familyMatch,
    };
  }

  return {
    approved: true,
    reason: "APPROVED_GOLD_PRODUCER",
    matchedFamily: familyMatch.family,
    registration: familyMatch,
  };
}

export const H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  failClosed: true as const,
  semantics: "FAMILY_SPECIFIC_CODE_PROVEN_PRODUCERS_ONLY_NO_ALIAS_INFERENCE" as const,
});
