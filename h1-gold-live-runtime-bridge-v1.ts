import {
  CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalOneRoofMarketSnapshot,
} from "./canonical-one-roof-market-snapshot.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";
import {
  H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1,
  type H1LiveSevenFamilyDirectionalProducerResult,
} from "./h1-live-seven-family-directional-producer.js";
import {
  H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1,
  attestH1RemainingDirectionalFamilies,
  type H1RemainingDirectionalFamily,
} from "./h1-remaining-family-directional-attestor.js";
import type { H1GoldExactFamilySignal } from "./h1-gold-evidence-adapter-v1.js";

export const H1_GOLD_LIVE_RUNTIME_BRIDGE_V1 = "H1_GOLD_LIVE_RUNTIME_BRIDGE_V1" as const;

export const H1_GOLD_LIVE_RUNTIME_SOURCES = Object.freeze({
  dataIntegrity: "H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1",
  spotStructure: "H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1",
  targetFuturesPositioning: "H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1",
  leaderPositioning: "H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1",
  chainRepositioning: "H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1",
} as const);

const FAMILY_MAP = Object.freeze({
  spotStructure: "MARKET_STRUCTURE",
  targetFuturesPositioning: "FUTURES_CONFIRMATION",
  leaderPositioning: "HEAVYWEIGHTS",
  chainRepositioning: "OI_POSITIONING",
} as const satisfies Record<string, H1RemainingDirectionalFamily>);

type MappedGoldFamily = keyof typeof FAMILY_MAP;

export interface H1GoldLiveRuntimeBridgeInput {
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  directionSource: H1ExactLiveSpotDirectionResult;
  sevenFamilyProducer: H1LiveSevenFamilyDirectionalProducerResult;
  sourceManifestHash: string;
}

export interface H1GoldLiveRuntimeBridgeResult {
  version: typeof H1_GOLD_LIVE_RUNTIME_BRIDGE_V1;
  ready: boolean;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  dataIntegrity: H1GoldExactFamilySignal;
  spotStructure: H1GoldExactFamilySignal;
  targetFuturesPositioning: H1GoldExactFamilySignal;
  leaderPositioning: H1GoldExactFamilySignal;
  chainRepositioning: H1GoldExactFamilySignal;
  blockers: string[];
  mappedCoreFamilyCount: number;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  candidateSelected: false;
  createsOrders: false;
  failClosed: true;
  semantics: "TYPED_CANONICAL_AND_ATTESTED_RUNTIME_BRIDGE_NO_ALIAS_NO_THRESHOLD_NO_INFERENCE";
}

const safety = Object.freeze({
  productionImpact: "NONE" as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  candidateSelected: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "TYPED_CANONICAL_AND_ATTESTED_RUNTIME_BRIDGE_NO_ALIAS_NO_THRESHOLD_NO_INFERENCE" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function missingSignal(
  source: string,
  snapshotId: string,
  observedAt: string,
  reasons: string[],
): H1GoldExactFamilySignal {
  return {
    state: "MISSING",
    source,
    snapshotId,
    observedAt,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: unique(reasons),
  };
}

function passSignal(
  source: string,
  snapshotId: string,
  observedAt: string,
  reasons: string[],
): H1GoldExactFamilySignal {
  return {
    state: "PASS",
    source,
    snapshotId,
    observedAt,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: unique(reasons),
  };
}

function validateCanonical(input: H1GoldLiveRuntimeBridgeInput): string[] {
  const reasons: string[] = [];
  const snapshot = input?.canonicalSnapshot;
  const observedAtMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;

  if (!snapshot) return ["MISSING_CANONICAL_SNAPSHOT"];
  if (snapshot.version !== CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2) reasons.push("INVALID_CANONICAL_SNAPSHOT_VERSION");
  if (!snapshot.snapshotId?.trim()) reasons.push("MISSING_CANONICAL_SNAPSHOT_ID");
  if (snapshot.symbol !== input.symbol) reasons.push("CANONICAL_SYMBOL_MISMATCH");
  if (!Number.isFinite(observedAtMs)) reasons.push("INVALID_CANDIDATE_TIMESTAMP");
  if (!Number.isFinite(snapshot.asOfMs) || snapshot.asOfMs !== observedAtMs) reasons.push("CANONICAL_DECISION_TIMESTAMP_MISMATCH");

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

function validateProducer(input: H1GoldLiveRuntimeBridgeInput): string[] {
  const p = input?.sevenFamilyProducer;
  const reasons: string[] = [];
  if (!p || p.version !== H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1) reasons.push("INVALID_SEVEN_FAMILY_PRODUCER_VERSION");
  if (p?.ready !== true) reasons.push("SEVEN_FAMILY_PRODUCER_NOT_READY");
  if (!Array.isArray(p?.blockers) || p.blockers.length > 0) reasons.push("SEVEN_FAMILY_PRODUCER_BLOCKED");
  if (!Array.isArray(p?.evidence) || p.evidence.length !== 7) reasons.push("SEVEN_FAMILY_EVIDENCE_INCOMPLETE");
  if (p?.contextOnlyEvidencePromoted !== false) reasons.push("CONTEXT_ONLY_PROMOTION_NOT_ALLOWED");
  if (p?.optionSideInferenceUsed !== false) reasons.push("PRODUCER_OPTION_SIDE_INFERENCE_NOT_ALLOWED");
  if (p?.calibratedProbabilityClaimed !== false) reasons.push("CALIBRATED_PROBABILITY_CLAIM_NOT_ALLOWED");
  if (p?.createsOrders !== false || p?.affectsExecution !== false || p?.failClosed !== true) reasons.push("UNSAFE_SEVEN_FAMILY_PRODUCER_CONTRACT");
  if (typeof input?.sourceManifestHash !== "string" || !input.sourceManifestHash.trim()) reasons.push("INVALID_SOURCE_MANIFEST");
  return unique(reasons);
}

function makeBase(
  input: H1GoldLiveRuntimeBridgeInput,
  dataIntegrity: H1GoldExactFamilySignal,
  coreSignals: Record<MappedGoldFamily, H1GoldExactFamilySignal>,
  blockers: string[],
  mappedCoreFamilyCount: number,
): H1GoldLiveRuntimeBridgeResult {
  return {
    version: H1_GOLD_LIVE_RUNTIME_BRIDGE_V1,
    ready: blockers.length === 0 && mappedCoreFamilyCount === 4 && dataIntegrity.state === "PASS",
    symbol: input.symbol,
    side: input.side,
    observedAt: input.observedAt,
    dataIntegrity,
    ...coreSignals,
    blockers: unique(blockers),
    mappedCoreFamilyCount,
    ...safety,
  };
}

/**
 * Converts only code-attested live runtime facts into Gold-family signals.
 *
 * This bridge does not accept generic caller-provided PASS strings. It rebuilds
 * the canonical snapshot, re-runs the side-aware remaining-family attestor from
 * the exact seven-family producer evidence, and requires each mapped upstream
 * row to be stamped at the exact canonical decision timestamp. Any mismatch is
 * MISSING, never inferred PASS.
 */
export function buildH1GoldLiveRuntimeBridge(input: H1GoldLiveRuntimeBridgeInput): H1GoldLiveRuntimeBridgeResult {
  const snapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT";
  const observedAt = validIso(input?.observedAt) ? input.observedAt : new Date(0).toISOString();
  const canonicalReasons = validateCanonical(input);
  const producerReasons = validateProducer(input);

  const dataIntegrity = canonicalReasons.length === 0
    ? passSignal(
      H1_GOLD_LIVE_RUNTIME_SOURCES.dataIntegrity,
      snapshotId,
      observedAt,
      ["CANONICAL_ROOT_REBUILT_AND_STRICT_FILTER_READY"],
    )
    : missingSignal(
      H1_GOLD_LIVE_RUNTIME_SOURCES.dataIntegrity,
      snapshotId,
      observedAt,
      canonicalReasons,
    );

  const coreSignals = {} as Record<MappedGoldFamily, H1GoldExactFamilySignal>;
  for (const family of Object.keys(FAMILY_MAP) as MappedGoldFamily[]) {
    coreSignals[family] = missingSignal(
      H1_GOLD_LIVE_RUNTIME_SOURCES[family],
      snapshotId,
      observedAt,
      canonicalReasons.length > 0 ? canonicalReasons : producerReasons.length > 0 ? producerReasons : ["ATTESTED_CORE_EVIDENCE_NOT_READY"],
    );
  }

  if (canonicalReasons.length > 0 || producerReasons.length > 0) {
    return makeBase(input, dataIntegrity, coreSignals, [...canonicalReasons, ...producerReasons], 0);
  }

  const attested = attestH1RemainingDirectionalFamilies({
    symbol: input.symbol,
    selectedOptionSide: input.side,
    directionSource: input.directionSource,
    evidence: input.sevenFamilyProducer.evidence,
    sourceManifestHash: input.sourceManifestHash,
    nowMs: input.canonicalSnapshot.asOfMs,
  });

  const attestorReasons: string[] = [];
  if (attested.version !== H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1) attestorReasons.push("INVALID_REMAINING_FAMILY_ATTESTOR_VERSION");
  if (attested.ready !== true) attestorReasons.push("REMAINING_FAMILY_ATTESTOR_NOT_READY");
  if (attested.requiredFamilyCount !== 7 || attested.verifiedFamilyCount !== 7) attestorReasons.push("REMAINING_FAMILY_ATTESTATION_INCOMPLETE");
  if (!Array.isArray(attested.blockers) || attested.blockers.length > 0) attestorReasons.push(...(attested.blockers ?? ["REMAINING_FAMILY_ATTESTOR_BLOCKED"]));
  if (attested.contextOnlyEvidencePromoted !== false || attested.optionSideDirectionInferred !== false || attested.scoresComputed !== false || attested.candidateSelected !== false) {
    attestorReasons.push("UNSAFE_REMAINING_FAMILY_ATTESTOR_SEMANTICS");
  }
  if (attested.sendsTelegram !== false || attested.createsOrders !== false || attested.affectsExecution !== false || attested.failClosed !== true) {
    attestorReasons.push("UNSAFE_REMAINING_FAMILY_ATTESTOR_AUTHORITY");
  }

  if (attestorReasons.length > 0) {
    for (const family of Object.keys(FAMILY_MAP) as MappedGoldFamily[]) {
      coreSignals[family] = missingSignal(H1_GOLD_LIVE_RUNTIME_SOURCES[family], snapshotId, observedAt, attestorReasons);
    }
    return makeBase(input, dataIntegrity, coreSignals, attestorReasons, 0);
  }

  let mappedCoreFamilyCount = 0;
  const mappingBlockers: string[] = [];
  for (const family of Object.keys(FAMILY_MAP) as MappedGoldFamily[]) {
    const upstreamFamily = FAMILY_MAP[family];
    const rows = attested.envelopes.filter((row) => row?.signal?.family === upstreamFamily);
    if (rows.length !== 1) {
      const reason = `${upstreamFamily}:${rows.length === 0 ? "ATTESTED_ENVELOPE_MISSING" : "ATTESTED_ENVELOPE_DUPLICATE"}`;
      mappingBlockers.push(reason);
      coreSignals[family] = missingSignal(H1_GOLD_LIVE_RUNTIME_SOURCES[family], snapshotId, observedAt, [reason]);
      continue;
    }

    const row = rows[0];
    const exactTimestamp = row.observedAtMs === input.canonicalSnapshot.asOfMs;
    const valid = row.provenance === "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1"
      && row.symbol === input.symbol
      && exactTimestamp
      && row.signal.family === upstreamFamily
      && row.signal.stance === "BUYER_SUPPORT"
      && row.signal.deterministic === true
      && row.signal.evidenceReady === true
      && row.signal.grantsDirectionalSupport === true
      && typeof row.signal.sourceId === "string" && row.signal.sourceId.trim().length > 0
      && typeof row.signal.sourceManifestHash === "string" && row.signal.sourceManifestHash === input.sourceManifestHash
      && Array.isArray(row.signal.devilFlags) && row.signal.devilFlags.length === 0;

    if (!valid) {
      const reason = `${upstreamFamily}:${exactTimestamp ? "ATTESTED_ENVELOPE_INVALID" : "NOT_EXACT_CANONICAL_DECISION_TIMESTAMP"}`;
      mappingBlockers.push(reason);
      coreSignals[family] = missingSignal(H1_GOLD_LIVE_RUNTIME_SOURCES[family], snapshotId, observedAt, [reason]);
      continue;
    }

    coreSignals[family] = passSignal(
      H1_GOLD_LIVE_RUNTIME_SOURCES[family],
      snapshotId,
      observedAt,
      [
        `ATTESTED_UPSTREAM_FAMILY_${upstreamFamily}`,
        `ATTESTED_SOURCE_${row.signal.sourceId}`,
        "EXACT_CANONICAL_DECISION_TIMESTAMP",
      ],
    );
    mappedCoreFamilyCount += 1;
  }

  return makeBase(input, dataIntegrity, coreSignals, mappingBlockers, mappedCoreFamilyCount);
}
