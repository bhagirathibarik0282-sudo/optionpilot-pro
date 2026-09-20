import {
  createBusinessForwardJournal,
  type BusinessForwardJournalRecord,
} from "./business-forward-journal-v1.js";
import type {
  CanonicalBusinessCandidateMissionInput,
  CanonicalBusinessCandidateMissionResult,
} from "./canonical-business-candidate-mission.js";
import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";

export const CANONICAL_BUSINESS_FORWARD_JOURNAL_ADAPTER_V1 =
  "CANONICAL_BUSINESS_FORWARD_JOURNAL_ADAPTER_V1" as const;

export interface CanonicalBusinessForwardJournalAdapterInput {
  missionInput: CanonicalBusinessCandidateMissionInput;
  missionResult: CanonicalBusinessCandidateMissionResult;
  consumer: CanonicalBusinessConsumerResult | null;
}

export interface CanonicalBusinessForwardJournalAdapterResult {
  version: typeof CANONICAL_BUSINESS_FORWARD_JOURNAL_ADAPTER_V1;
  ready: boolean;
  decisionId: string | null;
  candidateKey: string | null;
  journal: BusinessForwardJournalRecord | null;
  blockers: string[];
  readOnly: true;
  forwardEvidenceOnly: true;
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  readOnly: true as const,
  forwardEvidenceOnly: true as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function fail(blockers: string[]): CanonicalBusinessForwardJournalAdapterResult {
  return {
    version: CANONICAL_BUSINESS_FORWARD_JOURNAL_ADAPTER_V1,
    ready: false,
    decisionId: null,
    candidateKey: null,
    journal: null,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

/**
 * Freezes the already-authoritative canonical buyer candidate into the existing
 * forward journal. It does not select/rank a candidate and cannot affect the
 * same T0 decision.
 *
 * The mission input is required only to preserve the exact canonical T0
 * snapshot timestamp; it is cross-checked against the successful mission
 * result and canonical consumer before the journal is created.
 */
export function buildCanonicalBusinessForwardJournal(
  input: CanonicalBusinessForwardJournalAdapterInput,
): CanonicalBusinessForwardJournalAdapterResult {
  const missionInput = input?.missionInput;
  const mission = input?.missionResult;
  const consumer = input?.consumer;
  const candidate = consumer?.buyerCandidate ?? null;
  const blockers: string[] = [];

  if (missionInput?.provenance !== "LIVE_CANONICAL_BUSINESS_MISSION_V1") {
    blockers.push("CANONICAL_MISSION_INPUT_REQUIRED");
  }
  if (
    !mission
    || mission.version !== "CANONICAL_BUSINESS_CANDIDATE_MISSION_V1"
    || mission.ready !== true
    || mission.state !== "BUSINESS_CANDIDATE_READY"
  ) {
    blockers.push("SUCCESSFUL_CANONICAL_MISSION_REQUIRED");
  }
  if (
    mission?.soleSelectorAuthority !== "EXECUTION_CANDIDATE_SELECTOR_V2"
    || mission?.createsOrders !== false
    || mission?.affectsExecution !== false
    || mission?.aiMayOverride !== false
    || mission?.failClosed !== true
  ) {
    blockers.push("CANONICAL_MISSION_AUTHORITY_BOUNDARY_INVALID");
  }

  if (!consumer || consumer.version !== "CANONICAL_BUSINESS_CONSUMER_V1" || !candidate) {
    blockers.push("CANONICAL_BUSINESS_CONSUMER_REQUIRED");
  } else {
    if (
      consumer.affectsExecution !== false
      || consumer.createsOrders !== false
      || consumer.aiMayOverride !== false
    ) {
      blockers.push("CANONICAL_CONSUMER_AUTHORITY_BOUNDARY_INVALID");
    }
    if (
      consumer.decisionId !== candidate.decisionId
      || consumer.candidateKey !== candidate.candidateKey
      || consumer.sameCanonicalCandidateForDashboardAndTelegram !== true
    ) {
      blockers.push("CANONICAL_CONSUMER_IDENTITY_MISMATCH");
    }
    if (candidate.role !== "OPTION_BUYER" || candidate.sourceAuthority !== "EXECUTION_CANDIDATE_SELECTOR_V2") {
      blockers.push("AUTHORITATIVE_BUYER_CANDIDATE_REQUIRED");
    }
    if (candidate.symbol !== "NIFTY" && candidate.symbol !== "SENSEX") {
      blockers.push("BUSINESS_SYMBOL_NOT_SUPPORTED");
    }
  }

  const snapshotId = typeof missionInput?.snapshotId === "string" ? missionInput.snapshotId.trim() : "";
  const decisionId = typeof missionInput?.decisionId === "string" ? missionInput.decisionId.trim() : "";
  const observedAtMs = missionInput?.snapshotAsOfMs;

  if (!snapshotId || mission?.snapshotId !== snapshotId) blockers.push("MISSION_SNAPSHOT_ID_MISMATCH");
  if (!decisionId || mission?.decisionId !== decisionId) blockers.push("MISSION_DECISION_ID_MISMATCH");
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) blockers.push("VALID_CANONICAL_T0_TIMESTAMP_REQUIRED");
  if (
    candidate
    && (
      mission?.candidateKey !== candidate.candidateKey
      || decisionId !== candidate.decisionId
      || consumer?.candidateKey !== mission?.candidateKey
    )
  ) {
    blockers.push("MISSION_CONSUMER_CANDIDATE_IDENTITY_MISMATCH");
  }

  if (blockers.length > 0 || !candidate) return fail(blockers);

  const made = createBusinessForwardJournal({
    decisionId,
    snapshotId,
    observedAtMs,
    selectedCandidateKey: candidate.candidateKey,
    eligibleCandidates: [{
      candidateKey: candidate.candidateKey,
      symbol: candidate.symbol,
      optionSide: candidate.optionSide,
      strike: candidate.strike,
      expiryDate: candidate.expiryDate,
      dte: candidate.dte,
      premiumLtp: candidate.premiumLtp,
    }],
  });

  if (!made.ready || !made.record) {
    return fail(["FORWARD_JOURNAL_CREATION_FAILED", ...made.blockers]);
  }

  return {
    version: CANONICAL_BUSINESS_FORWARD_JOURNAL_ADAPTER_V1,
    ready: true,
    decisionId,
    candidateKey: candidate.candidateKey,
    journal: made.record,
    blockers: [],
    ...SAFETY,
  };
}
