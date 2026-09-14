import type { CanonicalBusinessEvidenceInputAdapterResult } from "./canonical-business-evidence-input-adapter.js";
import type { CanonicalBusinessDeterministicScoringResult } from "./canonical-business-deterministic-scoring.js";
import { canonicalBusinessRuntimeRegistry } from "./canonical-business-runtime-registry.js";
import { publishCanonicalLiveBusiness } from "./canonical-live-business-publisher.js";
import {
  canonicalMeaningfulContractKey,
  evaluateCanonicalTelegramTransport,
} from "./canonical-telegram-transport-gate.js";
import type { BusinessHorizon } from "./business-buyer-seller-layer.js";
import type { H1LiveSelectorEvaluation } from "./h1-live-selector-decision-producer.js";

export const CANONICAL_BUSINESS_CANDIDATE_MISSION_V1 = "CANONICAL_BUSINESS_CANDIDATE_MISSION_V1" as const;

export interface CanonicalBusinessCandidateMissionInput {
  provenance: "LIVE_CANONICAL_BUSINESS_MISSION_V1";
  snapshotId: string;
  decisionId: string;
  snapshotAsOfMs: number;
  nowMs: number;
  maxAgeMs?: number;
  telegramHorizon: BusinessHorizon;
  businessEvidence: CanonicalBusinessEvidenceInputAdapterResult;
  scoring: CanonicalBusinessDeterministicScoringResult;
  evaluations: H1LiveSelectorEvaluation[];
}

export interface CanonicalBusinessCandidateMissionResult {
  version: typeof CANONICAL_BUSINESS_CANDIDATE_MISSION_V1;
  ready: boolean;
  state: "BUSINESS_CANDIDATE_READY" | "BLOCKED";
  snapshotId: string | null;
  decisionId: string | null;
  candidateKey: string | null;
  meaningfulContractKey: string | null;
  blockers: string[];
  soleSelectorAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2";
  telegramTransportReady: boolean;
  niftySensexMutualExclusion: true;
  bankNiftyObservationOnly: true;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
  failClosed: true;
}

const SAFETY = {
  soleSelectorAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2" as const,
  niftySensexMutualExclusion: true as const,
  bankNiftyObservationOnly: true as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  aiMayOverride: false as const,
  failClosed: true as const,
};

function blocked(blockers: string[]): CanonicalBusinessCandidateMissionResult {
  return {
    version: CANONICAL_BUSINESS_CANDIDATE_MISSION_V1,
    ready: false,
    state: "BLOCKED",
    snapshotId: null,
    decisionId: null,
    candidateKey: null,
    meaningfulContractKey: null,
    blockers: [...new Set(blockers)],
    telegramTransportReady: false,
    ...SAFETY,
  };
}

/**
 * Final fail-closed promotion boundary from verified canonical evidence and the
 * sole hard selector into the shared Dashboard/Telegram runtime registry.
 *
 * It does not score raw data, select/rank a contract, send Telegram, or create
 * broker orders. It only publishes one already-selected NIFTY/SENSEX buyer
 * candidate when identity, freshness, business edge and mutual exclusion all
 * agree.
 */
export function promoteCanonicalBusinessCandidate(
  input: CanonicalBusinessCandidateMissionInput,
): CanonicalBusinessCandidateMissionResult {
  if (input?.provenance !== "LIVE_CANONICAL_BUSINESS_MISSION_V1") {
    return blocked(["INVALID_MISSION_PROVENANCE"]);
  }

  const snapshotId = typeof input.snapshotId === "string" ? input.snapshotId.trim() : "";
  const decisionId = typeof input.decisionId === "string" ? input.decisionId.trim() : "";
  if (!snapshotId || !decisionId) return blocked(["SNAPSHOT_AND_DECISION_ID_REQUIRED"]);

  const maxAgeMs = Number.isFinite(input.maxAgeMs) && Number(input.maxAgeMs) > 0
    ? Number(input.maxAgeMs)
    : 60_000;
  const ageMs = input.nowMs - input.snapshotAsOfMs;
  if (
    !Number.isFinite(input.nowMs)
    || !Number.isFinite(input.snapshotAsOfMs)
    || input.nowMs <= 0
    || input.snapshotAsOfMs <= 0
    || !Number.isFinite(ageMs)
    || ageMs < 0
    || ageMs > maxAgeMs
  ) {
    return blocked(["CANONICAL_SNAPSHOT_STALE_OR_FUTURE"]);
  }

  const evidence = input.businessEvidence;
  const scoring = input.scoring;
  if (
    !evidence?.ready
    || !scoring?.ready
    || !evidence.sourceManifestHash
    || evidence.sourceManifestHash !== scoring.sourceManifestHash
    || evidence.symbol !== scoring.symbol
  ) {
    return blocked(["BUSINESS_EVIDENCE_AND_SCORING_NOT_CANONICAL"]);
  }
  if (scoring.symbol === "BANKNIFTY" || scoring.businessUse !== "BUYER_ELIGIBLE") {
    return blocked(["BANKNIFTY_OBSERVATION_ONLY"]);
  }
  if (scoring.symbol !== "NIFTY" && scoring.symbol !== "SENSEX") {
    return blocked(["UNSUPPORTED_BUSINESS_SYMBOL"]);
  }

  const evaluations = Array.isArray(input.evaluations) ? input.evaluations : [];
  const selects = evaluations.filter((row) => row?.selector?.decision === "SELECT");
  if (selects.length !== 1) return blocked(["EXACTLY_ONE_LIVE_SELECT_REQUIRED"]);
  const evaluation = selects[0];
  if (
    evaluation.selector.version !== "EXECUTION_CANDIDATE_SELECTOR_V2"
    || evaluation.candidate.symbol !== scoring.symbol
    || !evaluation.selector.candidateKey
  ) {
    return blocked(["SELECTOR_AND_BUSINESS_SYMBOL_MISMATCH"]);
  }

  const oppositeSymbol = scoring.symbol === "NIFTY" ? "SENSEX" : "NIFTY";
  if (canonicalBusinessRuntimeRegistry.read(oppositeSymbol)) {
    return blocked(["NIFTY_SENSEX_MUTUAL_EXCLUSION_ACTIVE"]);
  }

  if (!Array.isArray(scoring.horizons) || scoring.horizons.length !== 3) {
    return blocked(["THREE_SCORED_HORIZONS_REQUIRED"]);
  }
  const telegramView = scoring.horizons.find((row) => row.horizon === input.telegramHorizon);
  if (!telegramView) return blocked(["TELEGRAM_HORIZON_MISSING"]);
  if (
    telegramView.view.action !== "BUYER_EDGE"
    || telegramView.view.buyerStars < 4
    || telegramView.view.devilCheck !== "PASS"
  ) {
    return blocked(["BUSINESS_BUYER_EDGE_BELOW_TELEGRAM_GATE"]);
  }
  if (scoring.horizons.some((row) => row.view.devilCheck !== "PASS")) {
    return blocked(["BUSINESS_HORIZON_DEVIL_CHECK_BLOCKED"]);
  }

  const publish = publishCanonicalLiveBusiness(
    evaluation,
    {
      provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1",
      observedAtMs: input.snapshotAsOfMs,
      telegramQualityStars: telegramView.view.buyerStars,
      horizons: scoring.horizons.map((row) => ({
        horizon: row.horizon,
        buyerScore: row.buyerScore,
        sellerScore: row.sellerScore,
        evidenceReady: true,
        devilFlags: [],
        reasons: [...row.view.reasons],
      })),
      devilFlags: [],
    },
  );
  if (!publish.accepted || !publish.candidateKey) {
    return blocked([`CANONICAL_PUBLISH_${publish.reason}`]);
  }

  const consumer = canonicalBusinessRuntimeRegistry.read(scoring.symbol);
  const meaningfulContractKey = canonicalMeaningfulContractKey(consumer);
  const transport = evaluateCanonicalTelegramTransport({
    consumer,
    meaningfulCandidateKey: meaningfulContractKey,
  });
  if (!transport.allowed || !meaningfulContractKey) {
    canonicalBusinessRuntimeRegistry.clear(scoring.symbol);
    return blocked([`TELEGRAM_TRANSPORT_${transport.reason}`]);
  }

  return {
    version: CANONICAL_BUSINESS_CANDIDATE_MISSION_V1,
    ready: true,
    state: "BUSINESS_CANDIDATE_READY",
    snapshotId,
    decisionId,
    candidateKey: publish.candidateKey,
    meaningfulContractKey,
    blockers: [],
    telegramTransportReady: true,
    ...SAFETY,
  };
}
