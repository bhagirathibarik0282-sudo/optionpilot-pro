export const H1_LIVE_PUBLISHER_READINESS_AUDIT_VERSION = "H1_LIVE_PUBLISHER_READINESS_AUDIT_V1" as const;

export type PublisherSourceClass =
  | "LIVE_DETERMINISTIC_EXACT"
  | "LIVE_DETERMINISTIC_PARTIAL"
  | "RESEARCH_SHADOW_ONLY"
  | "UNVERIFIED_OR_MISSING";

export type PublisherGateName =
  | "capitalFit"
  | "liquidityOk"
  | "spreadOk"
  | "premiumResponseConfirmed"
  | "deltaGammaResponseConfirmed"
  | "thetaIvBurdenAcceptable"
  | "multiExpiryConflictAbsent"
  | "currentOrNearExpiryUsable"
  | "higherDteUsable"
  | "fallbackDteApproved";

export interface PublisherGateAudit {
  gate: PublisherGateName;
  sourceClass: PublisherSourceClass;
  knownSource: string | null;
  reason: string;
  publishAllowed: boolean;
}

export interface H1LivePublisherReadinessAudit {
  version: typeof H1_LIVE_PUBLISHER_READINESS_AUDIT_VERSION;
  publisherReady: false;
  gates: PublisherGateAudit[];
  blockers: string[];
  failClosed: true;
  semantics: "AUDIT_ONLY_NO_LIVE_GATE_INFERENCE_NO_SHADOW_PROMOTION";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const gates: PublisherGateAudit[] = [
  {
    gate: "capitalFit",
    sourceClass: "UNVERIFIED_OR_MISSING",
    knownSource: "option-buying-runtime-risk-bridge.ts",
    reason: "LIVE_RISK_AUTHORITY_EXISTS_BUT_DOES_NOT_PROVE_CANDIDATE_PREMIUM_CAPITAL_FIT",
    publishAllowed: false,
  },
  {
    gate: "liquidityOk",
    sourceClass: "LIVE_DETERMINISTIC_PARTIAL",
    knownSource: "execution-liquidity-spread-gate.ts",
    reason: "COMBINED_LIQUIDITY_AND_SPREAD_ALLOW_BLOCK_EXISTS_BUT_INDEPENDENT_LIQUIDITY_BOOLEAN_MAPPING_NOT_FROZEN",
    publishAllowed: false,
  },
  {
    gate: "spreadOk",
    sourceClass: "LIVE_DETERMINISTIC_PARTIAL",
    knownSource: "execution-liquidity-spread-gate.ts",
    reason: "COMBINED_LIQUIDITY_AND_SPREAD_ALLOW_BLOCK_EXISTS_BUT_INDEPENDENT_SPREAD_BOOLEAN_MAPPING_NOT_FROZEN",
    publishAllowed: false,
  },
  {
    gate: "premiumResponseConfirmed",
    sourceClass: "RESEARCH_SHADOW_ONLY",
    knownSource: "premium-behaviour-engine.ts / candidate-style-selector.ts",
    reason: "KNOWN_CONFIRMATION_FIELDS_ARE_RESEARCH_SHADOW_ONLY",
    publishAllowed: false,
  },
  {
    gate: "deltaGammaResponseConfirmed",
    sourceClass: "RESEARCH_SHADOW_ONLY",
    knownSource: "candidate-style-selector.ts",
    reason: "KNOWN_DELTA_GAMMA_CONFIRMATION_FIELD_IS_RESEARCH_SHADOW_ONLY",
    publishAllowed: false,
  },
  {
    gate: "thetaIvBurdenAcceptable",
    sourceClass: "RESEARCH_SHADOW_ONLY",
    knownSource: "candidate-style-selector.ts / premium-behaviour-engine.ts",
    reason: "KNOWN_THETA_IV_FIELDS_ARE_RESEARCH_SHADOW_ONLY",
    publishAllowed: false,
  },
  {
    gate: "multiExpiryConflictAbsent",
    sourceClass: "RESEARCH_SHADOW_ONLY",
    knownSource: "candidate-style-selector.ts",
    reason: "KNOWN_MULTI_EXPIRY_ALIGNMENT_OR_CONFLICT_FIELDS_ARE_RESEARCH_SHADOW_ONLY",
    publishAllowed: false,
  },
  {
    gate: "currentOrNearExpiryUsable",
    sourceClass: "LIVE_DETERMINISTIC_PARTIAL",
    knownSource: "scalp-execution-gate.ts",
    reason: "NEAREST_DTE_USABLE_IS_CONSUMED_BY_LIVE_CAPABLE_GATE_BUT_EXACT_PRODUCER_SOURCE_AND_POLICY_BINDING_NOT_FROZEN",
    publishAllowed: false,
  },
  {
    gate: "higherDteUsable",
    sourceClass: "UNVERIFIED_OR_MISSING",
    knownSource: null,
    reason: "NO_VERIFIED_LIVE_DETERMINISTIC_HIGHER_DTE_USABILITY_PRODUCER",
    publishAllowed: false,
  },
  {
    gate: "fallbackDteApproved",
    sourceClass: "UNVERIFIED_OR_MISSING",
    knownSource: null,
    reason: "NO_VERIFIED_LIVE_DETERMINISTIC_FALLBACK_DTE_APPROVAL_PRODUCER",
    publishAllowed: false,
  },
];

export function auditH1LivePublisherReadiness(): H1LivePublisherReadinessAudit {
  const blockers = gates
    .filter((gate) => gate.sourceClass !== "LIVE_DETERMINISTIC_EXACT" || gate.publishAllowed !== true)
    .map((gate) => `PUBLISHER_GATE_NOT_EXACT:${gate.gate}:${gate.sourceClass}`);

  return {
    version: H1_LIVE_PUBLISHER_READINESS_AUDIT_VERSION,
    publisherReady: false,
    gates: gates.map((gate) => ({ ...gate })),
    blockers,
    failClosed: true,
    semantics: "AUDIT_ONLY_NO_LIVE_GATE_INFERENCE_NO_SHADOW_PROMOTION",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
