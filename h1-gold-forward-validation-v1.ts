import type { BusinessForwardJournalRecord, ForwardOutcomePoint } from "./business-forward-journal-v1.js";
import { computeBusinessForwardKpis } from "./business-forward-kpi-v1.js";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "./h1-gold-evidence-adapter-v1.js";
import { evaluateH1GoldPromotionFirewall } from "./h1-gold-promotion-firewall-v1.js";

export const H1_GOLD_FORWARD_VALIDATION_V1 = "H1_GOLD_FORWARD_VALIDATION_V1" as const;

export type H1GoldForwardValidationState =
  | "BLOCKED"
  | "EVIDENCE_COLLECTION_REQUIRED"
  | "STRUCTURALLY_VALID_EVIDENCE";

export interface H1GoldForwardValidationResult {
  version: typeof H1_GOLD_FORWARD_VALIDATION_V1;
  state: H1GoldForwardValidationState;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  canonicalSnapshotId: string | null;
  selectedCandidateKey: string | null;
  completedWindows: ForwardOutcomePoint["window"][];
  selectedTerminalReturnPct: number | null;
  selectedMfePct: number | null;
  selectedMaePct: number | null;
  blockerCodes: string[];
  reasonCodes: string[];
  classificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  performancePromotionThresholdDefined: false;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "GOLD_FORWARD_EVIDENCE_INTEGRITY_AND_DESCRIPTIVE_ANALYTICS_ONLY_NO_OUTCOME_POLICY_INVENTION";
}

const WINDOW_MINUTES: Record<ForwardOutcomePoint["window"], number> = {
  T_PLUS_3M: 3,
  T_PLUS_6M: 6,
  T_PLUS_15M: 15,
  T_PLUS_30M: 30,
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function base(
  input: H1GoldEvidenceAdapterResult,
  state: H1GoldForwardValidationState,
  blockerCodes: string[],
  reasonCodes: string[],
  selectedCandidateKey: string | null,
  completedWindows: ForwardOutcomePoint["window"][],
  selectedTerminalReturnPct: number | null,
  selectedMfePct: number | null,
  selectedMaePct: number | null,
): H1GoldForwardValidationResult {
  return {
    version: H1_GOLD_FORWARD_VALIDATION_V1,
    state,
    symbol: input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY",
    side: input?.side === "CE" ? "CE" : "PE",
    observedAt: Number.isFinite(Date.parse(input?.observedAt ?? "")) ? input.observedAt : new Date(0).toISOString(),
    canonicalSnapshotId: input?.canonicalSnapshotId?.trim() || null,
    selectedCandidateKey,
    completedWindows,
    selectedTerminalReturnPct,
    selectedMfePct,
    selectedMaePct,
    blockerCodes: unique(blockerCodes),
    reasonCodes: unique(reasonCodes),
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    performancePromotionThresholdDefined: false,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "GOLD_FORWARD_EVIDENCE_INTEGRITY_AND_DESCRIPTIVE_ANALYTICS_ONLY_NO_OUTCOME_POLICY_INVENTION",
  };
}

/**
 * Gold forward-evidence boundary.
 *
 * This layer deliberately does NOT define what a winning, losing or false-Gold
 * outcome is and does NOT define minimum sample size or a production promotion
 * threshold. Those are policy decisions that must be proven separately.
 *
 * It only verifies that a strict Gold decision was eligible to enter forward
 * validation and that later premium evidence is linked to the same frozen T0
 * snapshot/candidate set without survivorship or decision-time leakage. The
 * strongest result is STRUCTURALLY_VALID_EVIDENCE, never PRODUCTION_READY.
 */
export function validateH1GoldForwardEvidence(
  input: H1GoldEvidenceAdapterResult,
  journal: BusinessForwardJournalRecord | null | undefined,
): H1GoldForwardValidationResult {
  const blockers: string[] = [];

  if (!input || input.version !== H1_GOLD_EVIDENCE_ADAPTER_VERSION) {
    const fallback = (input ?? {}) as H1GoldEvidenceAdapterResult;
    return base(
      fallback,
      "BLOCKED",
      ["VALID_GOLD_ADAPTER_REQUIRED"],
      ["GOLD_FORWARD_VALIDATION_BLOCKED"],
      journal?.anchor?.selectedCandidateKey ?? null,
      [],
      null,
      null,
      null,
    );
  }

  const firewall = evaluateH1GoldPromotionFirewall(input);
  if (firewall.state !== "FORWARD_VALIDATION_REQUIRED") {
    blockers.push("GOLD_PROMOTION_FIREWALL_NOT_CLEARED");
    blockers.push(...firewall.blockerCodes.map((code) => `FIREWALL_${code}`));
  }

  if (!journal || journal.version !== "BUSINESS_FORWARD_JOURNAL_V1" || journal.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES") {
    blockers.push("VALID_IMMUTABLE_FORWARD_JOURNAL_REQUIRED");
  }

  const selectedCandidateKey = journal?.anchor?.selectedCandidateKey ?? null;
  const completedWindows = Array.isArray(journal?.outcomes)
    ? journal!.outcomes.map((point) => point.window)
    : [];

  if (journal) {
    if (!input.canonicalSnapshotId?.trim()) blockers.push("GOLD_CANONICAL_SNAPSHOT_ID_REQUIRED");
    if (journal.anchor?.snapshotId !== input.canonicalSnapshotId) blockers.push("FORWARD_SNAPSHOT_ID_MISMATCH");

    const decisionAtMs = Date.parse(input.observedAt);
    if (!Number.isFinite(decisionAtMs) || journal.anchor?.observedAtMs !== decisionAtMs) {
      blockers.push("FORWARD_T0_TIMESTAMP_MISMATCH");
    }

    if (!selectedCandidateKey) blockers.push("FROZEN_SELECTED_CANDIDATE_REQUIRED");

    const candidates = Array.isArray(journal.anchor?.eligibleCandidates)
      ? journal.anchor.eligibleCandidates
      : [];
    if (candidates.length === 0) blockers.push("FROZEN_CANDIDATE_SET_REQUIRED");

    const candidateKeys = candidates.map((candidate) => candidate.candidateKey);
    if (new Set(candidateKeys).size !== candidateKeys.length) blockers.push("DUPLICATE_FROZEN_CANDIDATE_KEY");
    if (selectedCandidateKey && !candidateKeys.includes(selectedCandidateKey)) {
      blockers.push("SELECTED_CANDIDATE_NOT_IN_FROZEN_SET");
    }

    for (const candidate of candidates) {
      if (candidate.symbol !== input.symbol) blockers.push(`FROZEN_SYMBOL_MISMATCH:${candidate.candidateKey}`);
      if (candidate.optionSide !== input.side) blockers.push(`FROZEN_SIDE_MISMATCH:${candidate.candidateKey}`);
      if (!Number.isFinite(candidate.premiumLtp) || candidate.premiumLtp <= 0) {
        blockers.push(`INVALID_T0_PREMIUM:${candidate.candidateKey}`);
      }
    }

    const seenWindows = new Set<string>();
    for (const point of journal.outcomes ?? []) {
      if (!(point.window in WINDOW_MINUTES)) {
        blockers.push(`INVALID_FORWARD_WINDOW:${String(point.window)}`);
        continue;
      }
      if (seenWindows.has(point.window)) blockers.push(`DUPLICATE_FORWARD_WINDOW:${point.window}`);
      seenWindows.add(point.window);

      const expectedAtMs = journal.anchor.observedAtMs + WINDOW_MINUTES[point.window] * 60_000;
      if (!Number.isFinite(point.observedAtMs) || point.observedAtMs < expectedAtMs) {
        blockers.push(`FORWARD_WINDOW_OBSERVED_BEFORE_TARGET:${point.window}`);
      }

      const observedKeys = Object.keys(point.premiumByCandidateKey ?? {});
      const missingKeys = candidateKeys.filter((key) => !(key in (point.premiumByCandidateKey ?? {})));
      const extraKeys = observedKeys.filter((key) => !candidateKeys.includes(key));
      if (missingKeys.length > 0) blockers.push(`SURVIVORSHIP_PARTIAL_OUTCOME:${point.window}`);
      if (extraKeys.length > 0) blockers.push(`OUTCOME_HAS_UNFROZEN_CANDIDATE:${point.window}`);
      for (const key of observedKeys) {
        const premium = point.premiumByCandidateKey[key];
        if (!Number.isFinite(premium) || premium <= 0) blockers.push(`INVALID_FORWARD_PREMIUM:${point.window}:${key}`);
      }
    }
  }

  if (blockers.length > 0) {
    return base(
      input,
      "BLOCKED",
      blockers,
      ["GOLD_FORWARD_VALIDATION_BLOCKED", "NO_PRODUCTION_AUTHORITY_GRANTED"],
      selectedCandidateKey,
      completedWindows,
      null,
      null,
      null,
    );
  }

  if (!journal || journal.outcomes.length === 0) {
    return base(
      input,
      "EVIDENCE_COLLECTION_REQUIRED",
      [],
      [
        "STRICT_GOLD_FIREWALL_CLEARED",
        "FROZEN_T0_IDENTITY_LINKED",
        "LIVE_FORWARD_OUTCOME_COLLECTION_REQUIRED",
        "NO_SAMPLE_OR_PERFORMANCE_THRESHOLD_INVENTED",
        "NO_PRODUCTION_AUTHORITY_GRANTED",
      ],
      selectedCandidateKey,
      [],
      null,
      null,
      null,
    );
  }

  const kpis = computeBusinessForwardKpis(journal);
  if (!kpis.ready) {
    return base(
      input,
      "BLOCKED",
      ["FORWARD_KPI_INTEGRITY_FAILED", ...kpis.blockers],
      ["GOLD_FORWARD_VALIDATION_BLOCKED", "NO_PRODUCTION_AUTHORITY_GRANTED"],
      selectedCandidateKey,
      completedWindows,
      null,
      null,
      null,
    );
  }

  const selected = selectedCandidateKey
    ? kpis.candidateKpis.find((candidate) => candidate.candidateKey === selectedCandidateKey) ?? null
    : null;
  if (!selected) {
    return base(
      input,
      "BLOCKED",
      ["SELECTED_CANDIDATE_FORWARD_KPI_REQUIRED"],
      ["GOLD_FORWARD_VALIDATION_BLOCKED", "NO_PRODUCTION_AUTHORITY_GRANTED"],
      selectedCandidateKey,
      completedWindows,
      null,
      null,
      null,
    );
  }

  return base(
    input,
    "STRUCTURALLY_VALID_EVIDENCE",
    [],
    [
      "STRICT_GOLD_FIREWALL_CLEARED",
      "FROZEN_T0_IDENTITY_LINKED",
      "POST_T0_FORWARD_EVIDENCE_STRUCTURALLY_VALID",
      "DESCRIPTIVE_ANALYTICS_ONLY",
      "OUTCOME_CLASSIFICATION_POLICY_NOT_DEFINED",
      "SAMPLE_SUFFICIENCY_POLICY_NOT_DEFINED",
      "PERFORMANCE_PROMOTION_THRESHOLD_NOT_DEFINED",
      "NO_PRODUCTION_AUTHORITY_GRANTED",
    ],
    selectedCandidateKey,
    completedWindows,
    selected.terminalReturnPct,
    selected.mfePct,
    selected.maePct,
  );
}
