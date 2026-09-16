import {
  CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalOneRoofMarketSnapshot,
} from "./canonical-one-roof-market-snapshot.js";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
  type H1GoldEligibilityResult,
} from "./h1-gold-eligibility-v1.js";
import { auditGoldProducer, type H1GoldProducerApprovalReason } from "./h1-gold-evidence-source-registry-v1.js";

export const H1_GOLD_EVIDENCE_ADAPTER_VERSION = "H1_GOLD_EVIDENCE_ADAPTER_V1" as const;

export type GoldExactProvenance = "RESEARCH_EXACT" | "LIVE_RUNTIME_EXACT";

export interface H1GoldExactFamilySignal {
  state: GoldEvidenceState;
  source: string;
  snapshotId: string;
  observedAt: string;
  provenance: GoldExactProvenance;
  reasonCodes?: string[];
}

export interface H1GoldEvidenceAdapterInput {
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
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
  snapshotId: string | null;
  observedAt: string | null;
  provenance: GoldExactProvenance | null;
  canonicalBound: boolean;
  producerApproved: boolean;
  producerApprovalReason: H1GoldProducerApprovalReason;
  producerMatchedFamily: GoldEvidenceFamily | null;
  futureLeakageBlocked: boolean;
  reasonCodes: string[];
}

export interface H1GoldEvidenceAdapterResult {
  version: typeof H1_GOLD_EVIDENCE_ADAPTER_VERSION;
  symbol: H1GoldEvidenceAdapterInput["symbol"];
  side: H1GoldEvidenceAdapterInput["side"];
  observedAt: string;
  canonicalSnapshotId: string | null;
  canonicalRootValid: boolean;
  canonicalRootReasonCodes: string[];
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
  semantics: "CANONICAL_EXACT_APPROVED_PRODUCER_MAPPING_ONLY_NO_MARKET_INFERENCE";
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

const FORBIDDEN_DECISION_LEAKAGE_MARKERS = [
  "FORWARD_MFE",
  "FORWARD_MAE",
  "FORWARD_OUTCOME",
  "OUTCOME_LABEL",
  "POST_ENTRY",
  "TARGET_HIT",
  "STOP_HIT",
  "FUTURE_KNOWN",
] as const;

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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasForbiddenDecisionLeakage(source: string | null, reasonCodes: string[]): boolean {
  const haystack = [source ?? "", ...reasonCodes].join("|").toUpperCase();
  return FORBIDDEN_DECISION_LEAKAGE_MARKERS.some((marker) => haystack.includes(marker));
}

function validateCanonicalRoot(input: H1GoldEvidenceAdapterInput): string[] {
  const reasons: string[] = [];
  const snapshot = input?.canonicalSnapshot;
  const candidateMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;

  if (!snapshot) return ["MISSING_CANONICAL_SNAPSHOT"];
  if (snapshot.version !== CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2) reasons.push("INVALID_CANONICAL_SNAPSHOT_VERSION");
  if (!snapshot.snapshotId?.trim()) reasons.push("MISSING_CANONICAL_SNAPSHOT_ID");
  if (snapshot.symbol !== input.symbol) reasons.push("CANONICAL_SYMBOL_MISMATCH");
  if (!Number.isFinite(candidateMs)) reasons.push("INVALID_CANDIDATE_TIMESTAMP");
  if (!Number.isFinite(snapshot.asOfMs) || snapshot.asOfMs !== candidateMs) {
    reasons.push("CANONICAL_DECISION_TIMESTAMP_MISMATCH");
  }

  const rebuilt = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    asOfMs: snapshot.asOfMs,
    minuteClosed: snapshot.minuteClosed,
    connectionId: snapshot.connectionId,
    instrumentMasterVersion: snapshot.instrumentMasterVersion,
    components: snapshot.components,
    freshnessBudgetsMs: snapshot.freshnessBudgetsMs,
    ingestTelemetry: snapshot.ingestTelemetry,
  });

  if (!rebuilt.readyForStrictFiltering) reasons.push("CANONICAL_NOT_READY_FOR_STRICT_FILTERING");
  if (rebuilt.qualityState !== "VERIFIED") reasons.push("CANONICAL_QUALITY_NOT_VERIFIED");
  if (rebuilt.newEntryGate !== "ALLOW_NEW_ENTRIES") reasons.push("CANONICAL_NEW_ENTRY_GATE_BLOCKED");
  if (rebuilt.internalBlockers.length > 0) reasons.push("CANONICAL_INTERNAL_BLOCKERS_PRESENT");

  return unique(reasons);
}

function adaptFamily(
  family: GoldEvidenceFamily,
  candidateObservedAt: string,
  canonicalSnapshotId: string | null,
  canonicalRootValid: boolean,
  rawSignal: H1GoldExactFamilySignal | undefined,
): H1GoldEvidenceFamilyAudit {
  const signal = rawSignal as Partial<H1GoldExactFamilySignal> | undefined;
  const requestedState = validState(signal?.state) ? signal.state : "INVALID";
  const source = typeof signal?.source === "string" && signal.source.trim().length > 0
    ? signal.source.trim()
    : null;
  const snapshotId = typeof signal?.snapshotId === "string" && signal.snapshotId.trim().length > 0
    ? signal.snapshotId.trim()
    : null;
  const provenance = validProvenance(signal?.provenance) ? signal.provenance : null;
  const observedAt = validIso(signal?.observedAt) ? signal.observedAt : null;
  const reasonCodes = normalizeReasonCodes(signal?.reasonCodes);

  if (requestedState === "INVALID") reasonCodes.push("INVALID_UPSTREAM_STATE");
  if (!source) reasonCodes.push("MISSING_UPSTREAM_SOURCE");
  if (!snapshotId) reasonCodes.push("MISSING_UPSTREAM_SNAPSHOT_ID");
  if (!provenance) reasonCodes.push("INVALID_UPSTREAM_PROVENANCE");
  if (!canonicalRootValid) reasonCodes.push("CANONICAL_ROOT_INVALID");

  const snapshotAligned = snapshotId !== null
    && canonicalSnapshotId !== null
    && snapshotId === canonicalSnapshotId;
  if (!snapshotAligned) reasonCodes.push("UPSTREAM_SNAPSHOT_ID_MISMATCH");

  const timestampAligned = observedAt !== null
    && validIso(candidateObservedAt)
    && Date.parse(observedAt) === Date.parse(candidateObservedAt);
  if (!timestampAligned) {
    reasonCodes.push(observedAt === null
      ? "MISSING_UPSTREAM_TIMESTAMP"
      : "UPSTREAM_DECISION_TIMESTAMP_MISMATCH");
  }

  const futureLeakageBlocked = hasForbiddenDecisionLeakage(source, reasonCodes);
  if (futureLeakageBlocked) reasonCodes.push("DECISION_TIME_FUTURE_LEAKAGE_BLOCKED");

  const producerApproval = auditGoldProducer(family, source, provenance);
  if (!producerApproval.approved) reasonCodes.push(producerApproval.reason);

  // MISSING is always preserved. PASS/FAIL are trusted only when they are bound
  // to the same canonical snapshot identity, exact decision timestamp, and a
  // family-specific code-proven producer. There is intentionally no generic
  // source alias or synchronized=true escape hatch.
  const metadataValid = source !== null
    && provenance !== null
    && canonicalRootValid
    && snapshotAligned
    && timestampAligned
    && producerApproval.approved
    && !futureLeakageBlocked;

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
    snapshotId,
    observedAt,
    provenance,
    canonicalBound: canonicalRootValid && snapshotAligned && timestampAligned,
    producerApproved: producerApproval.approved,
    producerApprovalReason: producerApproval.reason,
    producerMatchedFamily: producerApproval.matchedFamily,
    futureLeakageBlocked,
    reasonCodes: unique(reasonCodes),
  };
}

/**
 * Maps already-validated exact upstream family verdicts into the research-only
 * Gold eligibility boundary. This adapter deliberately performs no market
 * calculation and owns no PPD/OI/PCR/wall/spread/Z/star thresholds.
 *
 * horizonComplete is decision-time evidence only (available history/session
 * feasibility). Any post-entry MFE/MAE/target/stop/outcome marker is rejected.
 */
export function adaptH1GoldEvidence(input: H1GoldEvidenceAdapterInput): H1GoldEvidenceAdapterResult {
  const canonicalRootReasonCodes = validateCanonicalRoot(input);
  const canonicalRootValid = canonicalRootReasonCodes.length === 0;
  const canonicalSnapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || null;
  const families = {} as Record<GoldEvidenceFamily, GoldEvidenceState>;
  const familyAudit = {} as Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit>;

  for (const family of FAMILIES) {
    const audit = adaptFamily(
      family,
      input?.observedAt,
      canonicalSnapshotId,
      canonicalRootValid,
      input?.[family],
    );
    familyAudit[family] = audit;
    families[family] = audit.adaptedState;
  }

  const eligibility = evaluateH1GoldEligibility({
    symbol: input?.symbol,
    side: input?.side,
    observedAt: input?.observedAt,
    source: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    provenance: "RESEARCH_EXACT",
    families,
    notes: ["Mapped canonical-bound, family-approved exact upstream verdicts only; no thresholds calculated by adapter."],
  });

  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: input?.symbol,
    side: input?.side,
    observedAt: input?.observedAt,
    canonicalSnapshotId,
    canonicalRootValid,
    canonicalRootReasonCodes,
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
    semantics: "CANONICAL_EXACT_APPROVED_PRODUCER_MAPPING_ONLY_NO_MARKET_INFERENCE",
  };
}
