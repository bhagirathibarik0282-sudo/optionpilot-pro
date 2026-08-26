import { classifyFreshness, type FreshnessPolicy } from "./freshness-engine.js";
import { gateEvidence } from "./source-truth-audit.js";
import { validateOptionIdentity } from "./instrument-truth.js";
import type {
  ContractIdentity,
  EvidenceUsability,
  FreshnessState,
  IdentityState,
  QualityState,
  SourceProvider,
  SourceTruthEnvelope,
  SourceTruthReasonCode,
} from "./source-truth-types.js";

export interface TruthEnvelopeInput {
  expectedIdentity: ContractIdentity;
  actualIdentity: ContractIdentity;
  sourceProvider: SourceProvider;
  sourceTimestamp: string | null | undefined;
  receivedAt: string;
  computedAt?: string | null;
  policy: FreshnessPolicy;
  sourceVersion?: string | null;
  calculationVersion?: string | null;
  additionalReasons?: SourceTruthReasonCode[];
}

/**
 * Pure provenance envelope builder. It never fetches data and never produces a
 * market direction. Identity and freshness are both required for USABLE.
 */
export function buildTruthEnvelope(input: TruthEnvelopeInput): SourceTruthEnvelope {
  const identity = validateOptionIdentity(input.expectedIdentity, input.actualIdentity);
  const freshness = classifyFreshness(input.sourceTimestamp, input.receivedAt, input.policy);
  const gate = gateEvidence(identity, freshness, input.additionalReasons ?? []);
  return {
    identity: input.actualIdentity,
    sourceProvider: input.sourceProvider,
    sourceTimestamp: input.sourceTimestamp ?? null,
    receivedAt: input.receivedAt,
    computedAt: input.computedAt ?? null,
    dataAgeMs: freshness.dataAgeMs,
    freshnessState: freshness.state,
    identityState: identity.state,
    qualityState: gate.qualityState,
    usability: gate.usability,
    reasonCodes: gate.reasonCodes,
    sourceVersion: input.sourceVersion ?? null,
    calculationVersion: input.calculationVersion ?? null,
  };
}

export function openingGapPct(dayOpen: number | null | undefined, previousClose: number | null | undefined): number | null {
  if (!Number.isFinite(dayOpen) || !Number.isFinite(previousClose) || previousClose === 0) return null;
  return (((dayOpen as number) - (previousClose as number)) / (previousClose as number)) * 100;
}

export function returnFromPrevClosePct(current: number | null | undefined, previousClose: number | null | undefined): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previousClose) || previousClose === 0) return null;
  return (((current as number) - (previousClose as number)) / (previousClose as number)) * 100;
}

export interface CompatibleObservation {
  symbol: string;
  observedAt: string;
  sessionDate: string;
  expiry?: string | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  value: number | null;
  usability: EvidenceUsability;
}

export interface DeltaResult {
  value: number | null;
  usable: boolean;
  reason: "OK" | "NO_PREVIOUS_VALID" | "IDENTITY_MISMATCH" | "SESSION_GAP" | "CADENCE_GAP" | "NON_NUMERIC";
  elapsedMs: number | null;
}

function sameContract(a: CompatibleObservation, b: CompatibleObservation): boolean {
  return a.symbol === b.symbol &&
    (a.expiry ?? null) === (b.expiry ?? null) &&
    (a.strike ?? null) === (b.strike ?? null) &&
    (a.optionType ?? null) === (b.optionType ?? null);
}

/**
 * Derives change only from a previous compatible, usable observation. This is
 * suitable for OI/straddle/wall state deltas after the caller loads the latest
 * valid prior record from DB. It refuses overnight/session bridging.
 */
export function deriveCompatibleDelta(
  current: CompatibleObservation,
  previous: CompatibleObservation | null | undefined,
  maxCadenceMs: number,
): DeltaResult {
  if (!previous || previous.usability !== "USABLE") {
    return { value: null, usable: false, reason: "NO_PREVIOUS_VALID", elapsedMs: null };
  }
  if (!sameContract(current, previous)) {
    return { value: null, usable: false, reason: "IDENTITY_MISMATCH", elapsedMs: null };
  }
  if (current.sessionDate !== previous.sessionDate) {
    return { value: null, usable: false, reason: "SESSION_GAP", elapsedMs: null };
  }
  const now = new Date(current.observedAt).getTime();
  const before = new Date(previous.observedAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(before) || !Number.isFinite(current.value) || !Number.isFinite(previous.value)) {
    return { value: null, usable: false, reason: "NON_NUMERIC", elapsedMs: null };
  }
  const elapsedMs = now - before;
  if (elapsedMs <= 0 || elapsedMs > maxCadenceMs) {
    return { value: null, usable: false, reason: "CADENCE_GAP", elapsedMs };
  }
  return { value: (current.value as number) - (previous.value as number), usable: true, reason: "OK", elapsedMs };
}

export interface WallObservation {
  symbol: string;
  expiry: string;
  observedAt: string;
  sessionDate: string;
  strike: number | null;
  usability: EvidenceUsability;
}

export function deriveWallMigration(current: WallObservation, previous: WallObservation | null | undefined, maxCadenceMs: number): DeltaResult {
  return deriveCompatibleDelta(
    { symbol: current.symbol, expiry: current.expiry, observedAt: current.observedAt, sessionDate: current.sessionDate, value: current.strike, usability: current.usability },
    previous ? { symbol: previous.symbol, expiry: previous.expiry, observedAt: previous.observedAt, sessionDate: previous.sessionDate, value: previous.strike, usability: previous.usability } : null,
    maxCadenceMs,
  );
}

export interface FamilyHealthInput {
  family: string;
  freshnessState: FreshnessState;
  identityState?: IdentityState;
  qualityState?: QualityState;
  usability: EvidenceUsability;
  ageMs?: number | null;
  reasons?: SourceTruthReasonCode[];
}

export interface FamilyHealthSummary {
  family: string;
  state: "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNKNOWN";
  ageMs: number | null;
  reasons: SourceTruthReasonCode[];
  blocksNewEvidence: boolean;
}

export function summarizeFamilyHealth(input: FamilyHealthInput): FamilyHealthSummary {
  const reasons = [...new Set(input.reasons ?? [])];
  if (input.usability === "BLOCKED") {
    return { family: input.family, state: "BLOCKED", ageMs: input.ageMs ?? null, reasons, blocksNewEvidence: true };
  }
  if (input.freshnessState === "UNKNOWN" || input.identityState === "UNKNOWN" || input.qualityState === "UNKNOWN") {
    return { family: input.family, state: "UNKNOWN", ageMs: input.ageMs ?? null, reasons, blocksNewEvidence: true };
  }
  if (input.usability === "CONTEXT_ONLY" || input.freshnessState === "AGING" || input.identityState === "PARTIAL" || input.qualityState === "PARTIAL") {
    return { family: input.family, state: "DEGRADED", ageMs: input.ageMs ?? null, reasons, blocksNewEvidence: false };
  }
  return { family: input.family, state: "HEALTHY", ageMs: input.ageMs ?? null, reasons, blocksNewEvidence: false };
}
