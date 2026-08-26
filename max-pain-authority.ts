export const MAX_PAIN_AUTHORITY_VERSION = "MAX_PAIN_AUTHORITY_ISOLATION_V1" as const;

export const MAX_PAIN_CONTEXT_GUARD =
  "Max Pain is contextual expiry-equilibrium reference only; it is not a seller target, directional forecast, support/resistance promise, trade trigger, stop, target or independent vote." as const;

export type MaxPainUseClass =
  | "CONTEXT_DISPLAY"
  | "RAW_AVAILABILITY"
  | "DIRECTIONAL_VOTE"
  | "UNKNOWN_USE";

export interface MaxPainAuthorityAudit {
  version: typeof MAX_PAIN_AUTHORITY_VERSION;
  directionalVoteCount: number;
  contextDisplayCount: number;
  rawAvailabilityCount: number;
  unknownUseCount: number;
  promotionState: "BLOCKED" | "ELIGIBLE_FOR_SHADOW_REVIEW";
  productionDirectionalAuthorityAllowed: false;
  reasons: string[];
}

/**
 * Static source audit only. It intentionally does not patch or alter live trading logic.
 * Promotion stays blocked while a directional Max Pain vote exists anywhere in server.ts.
 */
export function auditMaxPainAuthority(source: string): MaxPainAuthorityAudit {
  const directionalPatterns = [
    /add\(["']max_pain["'],\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\)/g,
  ];
  const contextPatterns = [
    /Max Pain/g,
    /maxPainText/g,
    /\[MP\]/g,
  ];
  const rawAvailabilityPatterns = [
    /max_pain:\s*m\.maxPain\s*>\s*0\s*\?\s*m\.maxPain\s*:\s*null/g,
    /m\.maxPain\s*>\s*0/g,
  ];

  const directionalVoteCount = directionalPatterns.reduce(
    (n, p) => n + (source.match(p)?.length ?? 0),
    0,
  );
  const contextDisplayCount = contextPatterns.reduce(
    (n, p) => n + (source.match(p)?.length ?? 0),
    0,
  );
  const rawAvailabilityCount = rawAvailabilityPatterns.reduce(
    (n, p) => n + (source.match(p)?.length ?? 0),
    0,
  );

  // Unknown uses are deliberately not inferred from every bare `maxPain` token because
  // calculation/provenance plumbing is legitimate. The promotion gate is driven by
  // explicit directional authority plus the interpretation contract.
  const unknownUseCount = 0;
  const reasons: string[] = [];
  if (directionalVoteCount > 0) reasons.push("LEGACY_MAX_PAIN_DIRECTIONAL_VOTE_PRESENT");
  if (contextDisplayCount === 0) reasons.push("MAX_PAIN_CONTEXT_DISPLAY_NOT_DISCOVERED");
  if (rawAvailabilityCount === 0) reasons.push("MAX_PAIN_RAW_AVAILABILITY_PATH_NOT_DISCOVERED");

  return {
    version: MAX_PAIN_AUTHORITY_VERSION,
    directionalVoteCount,
    contextDisplayCount,
    rawAvailabilityCount,
    unknownUseCount,
    promotionState: directionalVoteCount > 0 ? "BLOCKED" : "ELIGIBLE_FOR_SHADOW_REVIEW",
    productionDirectionalAuthorityAllowed: false,
    reasons,
  };
}

export const PHASE48_MAX_PAIN_SAFETY = Object.freeze({
  shadowOnly: true,
  readOnlyForTrading: true,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  productionDirectionalAuthorityAllowed: false,
  promotionRequiresNoLegacyDirectionalVotes: true,
  contextRole: "EXPIRY_EQUILIBRIUM_REFERENCE_ONLY",
});
