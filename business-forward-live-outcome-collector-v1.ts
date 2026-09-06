import {
  appendForwardOutcome,
  type BusinessForwardJournalRecord,
  type ForwardOutcomePoint,
} from "./business-forward-journal-v1.js";
import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";

export const BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1 = "BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1" as const;

export type LiveForwardWindow = ForwardOutcomePoint["window"];

export interface BusinessForwardLiveOutcomeCollectorInput {
  journal: BusinessForwardJournalRecord;
  nowIso: string;
  window: LiveForwardWindow;
  maxRegistryAgeMs?: number;
  maxWindowLateMs?: number;
}

export interface BusinessForwardLiveOutcomeCollectorResult {
  version: typeof BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1;
  ready: boolean;
  window: LiveForwardWindow | null;
  expectedAtMs: number | null;
  observedAtMs: number | null;
  matchedCandidateCount: number;
  record: BusinessForwardJournalRecord | null;
  blockers: string[];
  semantics: "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  semantics: "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE" as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

const TARGET_MS: Record<LiveForwardWindow, number> = {
  T_PLUS_3M: 3 * 60_000,
  T_PLUS_6M: 6 * 60_000,
  T_PLUS_15M: 15 * 60_000,
  T_PLUS_30M: 30 * 60_000,
};

function fail(blockers: string[], window: LiveForwardWindow | null = null, expectedAtMs: number | null = null, observedAtMs: number | null = null): BusinessForwardLiveOutcomeCollectorResult {
  return {
    version: BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1,
    ready: false,
    window,
    expectedAtMs,
    observedAtMs,
    matchedCandidateCount: 0,
    record: null,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

/**
 * Explicit, read-only live outcome capture.
 * The caller chooses the target window; this function only accepts capture at
 * or shortly after the exact target time and only from the existing exact-live registry.
 */
export function collectBusinessForwardOutcomeFromH1Registry(
  input: BusinessForwardLiveOutcomeCollectorInput,
): BusinessForwardLiveOutcomeCollectorResult {
  const journal = input?.journal;
  if (!journal || journal.version !== "BUSINESS_FORWARD_JOURNAL_V1" || journal.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES") {
    return fail(["VALID_FORWARD_JOURNAL_REQUIRED"]);
  }
  if (!(input.window in TARGET_MS)) return fail(["VALID_FORWARD_WINDOW_REQUIRED"]);
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(nowMs)) return fail(["VALID_NOW_ISO_REQUIRED"], input.window);

  const expectedAtMs = journal.anchor.observedAtMs + TARGET_MS[input.window];
  const maxLate = typeof input.maxWindowLateMs === "number" && Number.isFinite(input.maxWindowLateMs) && input.maxWindowLateMs >= 0
    ? input.maxWindowLateMs
    : 120_000;

  if (nowMs < expectedAtMs) {
    return fail(["FORWARD_WINDOW_NOT_REACHED"], input.window, expectedAtMs, nowMs);
  }
  if (nowMs > expectedAtMs + maxLate) {
    return fail(["FORWARD_WINDOW_CAPTURE_TOO_LATE"], input.window, expectedAtMs, nowMs);
  }
  if (journal.outcomes.some((x) => x.window === input.window)) {
    return fail(["FORWARD_WINDOW_ALREADY_CAPTURED"], input.window, expectedAtMs, nowMs);
  }

  const registry = collectH1LiveSelectorDecisions(
    input.nowIso,
    typeof input.maxRegistryAgeMs === "number" && Number.isFinite(input.maxRegistryAgeMs) && input.maxRegistryAgeMs > 0
      ? input.maxRegistryAgeMs
      : 90_000,
  );

  if (!registry.eligibleForLiveH1Marking || registry.rejected.length > 0 || registry.producerRejected.length > 0) {
    return fail(
      [
        "H1_LIVE_SELECTOR_REGISTRY_NOT_READY",
        ...registry.rejected.flatMap((x) => x.blockers.map((b) => `REGISTRY_${b}`)),
        ...registry.producerRejected.map((x) => `REGISTRY_${x.reason}`),
      ],
      input.window,
      expectedAtMs,
      nowMs,
    );
  }

  const byKey = new Map<string, number>();
  for (const evaluation of registry.evaluations) {
    const key = evaluation.selector.candidateKey;
    const premium = evaluation.candidate.premiumLtp;
    if (key && typeof premium === "number" && Number.isFinite(premium) && premium > 0) {
      byKey.set(key, premium);
    }
  }

  const premiumByCandidateKey: Record<string, number> = {};
  const missing: string[] = [];
  for (const candidate of journal.anchor.eligibleCandidates) {
    const premium = byKey.get(candidate.candidateKey);
    if (premium == null) {
      missing.push(candidate.candidateKey);
      continue;
    }
    premiumByCandidateKey[candidate.candidateKey] = premium;
  }

  if (missing.length > 0) {
    return fail(
      missing.map((x) => `FROZEN_CANDIDATE_NOT_IN_EXACT_LIVE_REGISTRY:${x}`),
      input.window,
      expectedAtMs,
      nowMs,
    );
  }

  const appended = appendForwardOutcome(journal, {
    window: input.window,
    observedAtMs: nowMs,
    premiumByCandidateKey,
  });

  if (!appended.ready || !appended.record) {
    return fail(
      ["FORWARD_OUTCOME_APPEND_FAILED", ...appended.blockers],
      input.window,
      expectedAtMs,
      nowMs,
    );
  }

  return {
    version: BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1,
    ready: true,
    window: input.window,
    expectedAtMs,
    observedAtMs: nowMs,
    matchedCandidateCount: Object.keys(premiumByCandidateKey).length,
    record: appended.record,
    blockers: [],
    ...SAFETY,
  };
}
