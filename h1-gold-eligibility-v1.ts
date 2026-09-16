export const H1_GOLD_ELIGIBILITY_VERSION = "H1_GOLD_ELIGIBILITY_V1" as const;

export type GoldEvidenceState = "PASS" | "FAIL" | "MISSING";

export type GoldEvidenceFamily =
  | "dataIntegrity"
  | "premiumPair"
  | "spotStructure"
  | "targetFuturesPositioning"
  | "leaderPositioning"
  | "peerConflictAbsent"
  | "chainRepositioning"
  | "executionQuality"
  | "chasePhase"
  | "horizonComplete";

export interface H1GoldEligibilityEvidence {
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  source: string;
  provenance: "RESEARCH_EXACT" | "LIVE_RUNTIME_EXACT";
  families: Record<GoldEvidenceFamily, GoldEvidenceState>;
  notes?: string[];
}

export interface H1GoldEligibilityResult {
  version: typeof H1_GOLD_ELIGIBILITY_VERSION;
  decision: "GOLD_ELIGIBLE_RESEARCH" | "BLOCKED";
  passedFamilies: GoldEvidenceFamily[];
  failedFamilies: GoldEvidenceFamily[];
  missingFamilies: GoldEvidenceFamily[];
  reasonCodes: string[];
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "RESEARCH_GOLD_CONVERGENCE_AUDIT_ONLY_NO_THRESHOLD_PROMOTION";
}

const FAMILIES: GoldEvidenceFamily[] = [
  "dataIntegrity",
  "premiumPair",
  "spotStructure",
  "targetFuturesPositioning",
  "leaderPositioning",
  "peerConflictAbsent",
  "chainRepositioning",
  "executionQuality",
  "chasePhase",
  "horizonComplete",
];

function validIso(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function familyReason(prefix: "FAILED" | "MISSING", family: GoldEvidenceFamily): string {
  return `${prefix}_${family.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

/**
 * Research-only Gold eligibility boundary.
 *
 * This module intentionally does NOT calculate PPD, OI, PCR, wall, spread,
 * peer or chase thresholds. Those values must be produced by separately
 * validated evidence engines. Gold is granted only when every mandatory
 * evidence family is explicitly PASS. Missing evidence fails closed.
 *
 * The purpose is to prevent a high premium move / Z score / star score from
 * overriding a contradictory or unavailable evidence family.
 */
export function evaluateH1GoldEligibility(input: H1GoldEligibilityEvidence): H1GoldEligibilityResult {
  const passedFamilies: GoldEvidenceFamily[] = [];
  const failedFamilies: GoldEvidenceFamily[] = [];
  const missingFamilies: GoldEvidenceFamily[] = [];
  const reasonCodes: string[] = [];

  if (!input || (input.symbol !== "NIFTY" && input.symbol !== "SENSEX")) {
    reasonCodes.push("INVALID_GOLD_SYMBOL");
  }
  if (!input || (input.side !== "CE" && input.side !== "PE")) {
    reasonCodes.push("INVALID_GOLD_SIDE");
  }
  if (!input || !validIso(input.observedAt)) reasonCodes.push("INVALID_GOLD_OBSERVED_AT");
  if (!input || typeof input.source !== "string" || input.source.trim().length === 0) {
    reasonCodes.push("MISSING_GOLD_SOURCE");
  }
  if (!input || (input.provenance !== "RESEARCH_EXACT" && input.provenance !== "LIVE_RUNTIME_EXACT")) {
    reasonCodes.push("INVALID_GOLD_PROVENANCE");
  }

  for (const family of FAMILIES) {
    const state = input?.families?.[family];
    if (state === "PASS") passedFamilies.push(family);
    else if (state === "FAIL") {
      failedFamilies.push(family);
      reasonCodes.push(familyReason("FAILED", family));
    } else {
      missingFamilies.push(family);
      reasonCodes.push(familyReason("MISSING", family));
    }
  }

  const decision = reasonCodes.length === 0 ? "GOLD_ELIGIBLE_RESEARCH" : "BLOCKED";
  if (decision === "GOLD_ELIGIBLE_RESEARCH") reasonCodes.push("ALL_GOLD_EVIDENCE_FAMILIES_PASS");

  return {
    version: H1_GOLD_ELIGIBILITY_VERSION,
    decision,
    passedFamilies,
    failedFamilies,
    missingFamilies,
    reasonCodes,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "RESEARCH_GOLD_CONVERGENCE_AUDIT_ONLY_NO_THRESHOLD_PROMOTION",
  };
}
