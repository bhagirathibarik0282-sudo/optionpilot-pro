import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
  type H1GoldEligibilityResult,
} from "./h1-gold-eligibility-v1.js";

export const H1_GOLD_EVIDENCE_ADAPTER_VERSION = "H1_GOLD_EVIDENCE_ADAPTER_V1" as const;

export type GoldExactProvenance = "RESEARCH_EXACT" | "LIVE_RUNTIME_EXACT";

export interface H1GoldExactFamilySignal {
  state: GoldEvidenceState;
  source: string;
  observedAt?: string;
  provenance: GoldExactProvenance;
  reasonCodes?: string[];
  synchronized?: boolean;
}

export interface H1GoldEvidenceAdapterInput {
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  dataIntegrity: H1GoldExactFamilySignal;
  premiumPair: H1GoldExactFamilySignal;
  spotStructure: H1GoldExactFamilySignal;
  targetFuturesPositioning: H1GoldExactFamilySignal;
  leaderPositioning: H1GoldExactFamilySignal;
  peerConflictAbsent: H1GoldExactFamilySignal;
  chainRepositioning: H1GoldExactFamilySignal;
  executionQuality: H1GoldExactFamilySignal;
  chasePhase: H1GoldExactFamilySignal;
  horizonComplete: H1GoldExactFamilySignal;
}

export interface H1GoldEvidenceFamilyAudit {
  family: GoldEvidenceFamily;
  requestedState: GoldEvidenceState | "INVALID";
  adaptedState: GoldEvidenceState;
  source: string | null;
  observedAt: string | null;
  provenance: GoldExactProvenance | null;
  synchronized: boolean;
  reasonCodes: string[];
}

export interface H1GoldEvidenceAdapterResult {
  version: typeof H1_GOLD_EVIDENCE_ADAPTER_VERSION;
  symbol: H1GoldEvidenceAdapterInput["symbol"];
  side: H1GoldEvidenceAdapterInput["side"];
  observedAt: string;
  families: Record<GoldEvidenceFamily, GoldEvidenceState>;
  familyAudit: Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit>;
  eligibility: H1GoldEligibilityResult;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  calculatesThresholds: false;
  failClosed: true;
  semantics: "EXACT_EVIDENCE_MAPPING_ONLY_NO_MARKET_INFERENCE";
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

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validState(value: unknown): value is GoldEvidenceState {
  return value === "PASS" || value === "FAIL" || value === "MISSING";
}

function validProvenance(value: unknown): value is GoldExactProvenance {
  return value === "RESEARCH_EXACT" || value === "LIVE_RUNTIME_EXACT";
}

function normalizeReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function adaptFamily(
  family: GoldEvidenceFamily,
  candidateObservedAt: string,
  rawSignal: H1GoldExactFamilySignal | undefined,
): H1GoldEvidenceFamilyAudit {
  const signal = rawSignal as Partial<H1GoldExactFamilySignal> | undefined;
  const requestedState = validState(signal?.state) ? signal.state : "INVALID";
  const source = typeof signal?.source === "string" && signal.source.trim().length > 0
    ? signal.source.trim()
    : null;
  const provenance = validProvenance(signal?.provenance) ? signal.provenance : null;
  const observedAt = validIso(signal?.observedAt) ? signal.observedAt : null;
  const synchronized = signal?.synchronized === true;
  const reasonCodes = normalizeReasonCodes(signal?.reasonCodes);

  if (requestedState === "INVALID") reasonCodes.push("INVALID_UPSTREAM_STATE");
  if (!source) reasonCodes.push("MISSING_UPSTREAM_SOURCE");
  if (!provenance) reasonCodes.push("INVALID_UPSTREAM_PROVENANCE");

  const timestampAligned = observedAt !== null && observedAt === candidateObservedAt;
  const synchronizationAccepted = timestampAligned || synchronized;
  if (!synchronizationAccepted) {
    reasonCodes.push(observedAt === null
      ? "MISSING_UPSTREAM_TIMESTAMP_OR_SYNC_ASSERTION"
      : "UPSTREAM_TIMESTAMP_NOT_SYNCHRONIZED");
  }

  // MISSING is always preserved. PASS/FAIL are trusted only when their exact
  // source metadata and temporal synchronization are valid. Invalid metadata
  // can never be rescued by premium strength or another evidence family.
  const metadataValid = source !== null && provenance !== null && synchronizationAccepted;
  const adaptedState: GoldEvidenceState = requestedState === "MISSING"
    ? "MISSING"
    : requestedState !== "INVALID" && metadataValid
      ? requestedState
      : "MISSING";

  if (adaptedState === "MISSING" && requestedState !== "MISSING") {
    reasonCodes.push(`DOWNGRADED_${family.replace(/([A-Z])/g, "_$1").toUpperCase()}_TO_MISSING`);
  }

  return {
    family,
    requestedState,
    adaptedState,
    source,
    observedAt,
    provenance,
    synchronized,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/**
 * Maps already-validated exact upstream family verdicts into the research-only
 * Gold eligibility boundary. This adapter deliberately performs no market
 * calculation and owns no PPD/OI/PCR/wall/spread/Z/star thresholds.
 */
export function adaptH1GoldEvidence(input: H1GoldEvidenceAdapterInput): H1GoldEvidenceAdapterResult {
  const families = {} as Record<GoldEvidenceFamily, GoldEvidenceState>;
  const familyAudit = {} as Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit>;

  for (const family of FAMILIES) {
    const audit = adaptFamily(family, input?.observedAt, input?.[family]);
    familyAudit[family] = audit;
    families[family] = audit.adaptedState;
  }

  const eligibility = evaluateH1GoldEligibility({
    symbol: input?.symbol,
    side: input?.side,
    observedAt: input?.observedAt,
    source: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    // Gold eligibility itself is still research authority only. Per-family
    // provenance remains preserved in familyAudit, including live exact input.
    provenance: "RESEARCH_EXACT",
    families,
    notes: ["Mapped exact upstream family verdicts only; no thresholds calculated by adapter."],
  });

  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: input?.symbol,
    side: input?.side,
    observedAt: input?.observedAt,
    families,
    familyAudit,
    eligibility,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    calculatesThresholds: false,
    failClosed: true,
    semantics: "EXACT_EVIDENCE_MAPPING_ONLY_NO_MARKET_INFERENCE",
  };
}
