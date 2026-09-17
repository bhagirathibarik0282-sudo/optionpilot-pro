import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "./h1-gold-evidence-adapter-v1.js";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
} from "./h1-gold-eligibility-v1.js";
import { evaluateGoldenShadowCandidate } from "./h1-golden-shadow-candidate-v1.js";

export const H1_GOLD_PROMOTION_FIREWALL_V1 = "H1_GOLD_PROMOTION_FIREWALL_V1" as const;

export type H1GoldPromotionFirewallState = "BLOCKED" | "FORWARD_VALIDATION_REQUIRED";

export interface H1GoldPromotionFirewallResult {
  version: typeof H1_GOLD_PROMOTION_FIREWALL_V1;
  state: H1GoldPromotionFirewallState;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  strictEligibilityDecision: "GOLD_ELIGIBLE_RESEARCH" | "BLOCKED";
  shadowState: "REJECTED" | "WATCH" | "GOLDEN_SHADOW_CANDIDATE";
  auditedFamilies: GoldEvidenceFamily[];
  blockerCodes: string[];
  reasonCodes: string[];
  forwardValidationRequired: true;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "PRE_PROMOTION_FIREWALL_STRICT_GOLD_AUDITED_PRODUCERS_THEN_FORWARD_VALIDATION";
}

const ALL_FAMILIES: readonly GoldEvidenceFamily[] = [
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
] as const;

function snake(family: GoldEvidenceFamily): string {
  return family.replace(/([A-Z])/g, "_$1").toUpperCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Pre-promotion firewall for Gold research.
 *
 * This boundary deliberately cannot grant selector, Telegram or execution
 * authority. Its strongest possible result is FORWARD_VALIDATION_REQUIRED.
 * That means strict all-family Gold and exact producer audits are internally
 * coherent enough to enter an independent held-out/forward-validation stage.
 *
 * It recomputes strict Gold from adapted family states rather than trusting the
 * embedded eligibility decision and verifies every family audit. Synthetic
 * all-PASS fixtures, missing audits, cross-family producer aliases and
 * future-outcome leakage therefore fail closed.
 */
export function evaluateH1GoldPromotionFirewall(
  input: H1GoldEvidenceAdapterResult,
): H1GoldPromotionFirewallResult {
  const blockers: string[] = [];
  const auditedFamilies: GoldEvidenceFamily[] = [];

  const fallbackSymbol: "NIFTY" | "SENSEX" = input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY";
  const fallbackSide: "CE" | "PE" = input?.side === "CE" ? "CE" : "PE";
  const fallbackObservedAt = Number.isFinite(Date.parse(input?.observedAt ?? ""))
    ? input.observedAt
    : new Date(0).toISOString();

  if (!input || input.version !== H1_GOLD_EVIDENCE_ADAPTER_VERSION) {
    blockers.push("INVALID_GOLD_ADAPTER_VERSION");
  }
  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") blockers.push("INVALID_GOLD_SYMBOL");
  if (input?.side !== "CE" && input?.side !== "PE") blockers.push("INVALID_GOLD_SIDE");
  if (!Number.isFinite(Date.parse(input?.observedAt ?? ""))) blockers.push("INVALID_GOLD_OBSERVED_AT");
  if (input?.canonicalRootValid !== true) blockers.push("CANONICAL_ROOT_NOT_VALID_FOR_PROMOTION_REVIEW");

  const recomputed = evaluateH1GoldEligibility({
    symbol: fallbackSymbol,
    side: fallbackSide,
    observedAt: fallbackObservedAt,
    source: H1_GOLD_PROMOTION_FIREWALL_V1,
    provenance: "RESEARCH_EXACT",
    families: Object.fromEntries(
      ALL_FAMILIES.map((family) => [family, input?.families?.[family] ?? "MISSING"]),
    ) as Record<GoldEvidenceFamily, "PASS" | "FAIL" | "MISSING">,
  });

  if (input?.eligibility?.decision !== recomputed.decision) {
    blockers.push("EMBEDDED_ELIGIBILITY_DECISION_MISMATCH");
  }
  if (recomputed.decision !== "GOLD_ELIGIBLE_RESEARCH") {
    blockers.push("STRICT_GOLD_NOT_ELIGIBLE");
  }

  for (const family of ALL_FAMILIES) {
    const familyState = input?.families?.[family] ?? "MISSING";
    const audit = input?.familyAudit?.[family];

    if (familyState !== "PASS") blockers.push(`FAMILY_NOT_PASS_${snake(family)}`);
    if (!audit) {
      blockers.push(`MISSING_FAMILY_AUDIT_${snake(family)}`);
      continue;
    }
    if (audit.family !== family) blockers.push(`AUDIT_FAMILY_MISMATCH_${snake(family)}`);
    if (audit.adaptedState !== familyState) blockers.push(`AUDIT_STATE_MISMATCH_${snake(family)}`);
    if (audit.requestedState !== "PASS") blockers.push(`AUDIT_REQUEST_NOT_PASS_${snake(family)}`);
    if (audit.canonicalBound !== true) blockers.push(`AUDIT_NOT_CANONICAL_BOUND_${snake(family)}`);
    if (audit.producerApproved !== true) blockers.push(`AUDIT_PRODUCER_NOT_APPROVED_${snake(family)}`);
    if (audit.producerMatchedFamily !== family) blockers.push(`AUDIT_PRODUCER_FAMILY_MISMATCH_${snake(family)}`);
    if (audit.futureLeakageBlocked !== false) blockers.push(`AUDIT_FUTURE_LEAKAGE_${snake(family)}`);

    if (
      audit.family === family
      && audit.adaptedState === "PASS"
      && audit.requestedState === "PASS"
      && audit.canonicalBound === true
      && audit.producerApproved === true
      && audit.producerMatchedFamily === family
      && audit.futureLeakageBlocked === false
    ) {
      auditedFamilies.push(family);
    }
  }

  const shadow = input
    ? evaluateGoldenShadowCandidate(input)
    : ({ state: "REJECTED" } as ReturnType<typeof evaluateGoldenShadowCandidate>);
  if (shadow.state !== "GOLDEN_SHADOW_CANDIDATE") blockers.push(`SHADOW_STATE_${shadow.state}`);

  const blockerCodes = unique(blockers);
  const state: H1GoldPromotionFirewallState = blockerCodes.length === 0
    ? "FORWARD_VALIDATION_REQUIRED"
    : "BLOCKED";

  return {
    version: H1_GOLD_PROMOTION_FIREWALL_V1,
    state,
    symbol: fallbackSymbol,
    side: fallbackSide,
    observedAt: fallbackObservedAt,
    strictEligibilityDecision: recomputed.decision,
    shadowState: shadow.state,
    auditedFamilies,
    blockerCodes,
    reasonCodes: state === "FORWARD_VALIDATION_REQUIRED"
      ? [
          "STRICT_GOLD_RECOMPUTED_PASS",
          "ALL_FAMILY_AUDITS_PASS",
          "GOLDEN_SHADOW_CONVERGENCE_PASS",
          "INDEPENDENT_HELD_OUT_FORWARD_VALIDATION_REQUIRED",
          "NO_PRODUCTION_AUTHORITY_GRANTED",
        ]
      : ["GOLD_PROMOTION_FIREWALL_BLOCKED", ...blockerCodes],
    forwardValidationRequired: true,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "PRE_PROMOTION_FIREWALL_STRICT_GOLD_AUDITED_PRODUCERS_THEN_FORWARD_VALIDATION",
  };
}
