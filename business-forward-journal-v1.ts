export const BUSINESS_FORWARD_JOURNAL_V1 = "BUSINESS_FORWARD_JOURNAL_V1" as const;

export type ForwardWindow = "T0" | "T_PLUS_3M" | "T_PLUS_6M" | "T_PLUS_15M" | "T_PLUS_30M";

export interface FrozenCandidateObservation {
  candidateKey: string;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  optionSide: "CE" | "PE";
  strike: number;
  expiryDate: string;
  dte: number;
  premiumLtp: number;
  spread?: number | null;
  estimatedSlippage?: number | null;
}

export interface BusinessForwardAnchor {
  decisionId: string;
  snapshotId: string;
  observedAtMs: number;
  selectedCandidateKey: string | null;
  eligibleCandidates: FrozenCandidateObservation[];
  marketState?: string | null;
  sellerStressState?: string | null;
  opportunityStage?: string | null;
}

export interface ForwardOutcomePoint {
  window: Exclude<ForwardWindow, "T0">;
  observedAtMs: number;
  premiumByCandidateKey: Record<string, number>;
  oppositePremiumByCandidateKey?: Record<string, number>;
}

export interface BusinessForwardJournalRecord {
  version: typeof BUSINESS_FORWARD_JOURNAL_V1;
  semantics: "IMMUTABLE_T0_PLUS_LATER_OUTCOMES";
  anchor: Readonly<BusinessForwardAnchor>;
  outcomes: ReadonlyArray<Readonly<ForwardOutcomePoint>>;
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function validPositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function createBusinessForwardJournal(anchor: BusinessForwardAnchor): { ready: boolean; record: BusinessForwardJournalRecord | null; blockers: string[] } {
  const blockers: string[] = [];
  if (!anchor?.decisionId?.trim()) blockers.push("DECISION_ID_REQUIRED");
  if (!anchor?.snapshotId?.trim()) blockers.push("SNAPSHOT_ID_REQUIRED");
  if (!Number.isFinite(anchor?.observedAtMs) || anchor.observedAtMs <= 0) blockers.push("INVALID_T0_TIMESTAMP");
  if (!Array.isArray(anchor?.eligibleCandidates) || anchor.eligibleCandidates.length === 0) blockers.push("ELIGIBLE_CANDIDATES_REQUIRED");

  const keys: string[] = [];
  for (const c of anchor?.eligibleCandidates ?? []) {
    if (!c?.candidateKey?.trim()) blockers.push("CANDIDATE_KEY_REQUIRED");
    else keys.push(c.candidateKey);
    if (!validPositive(c?.strike) || !validPositive(c?.premiumLtp) || !Number.isInteger(c?.dte) || c.dte < 0 || !c?.expiryDate?.trim()) {
      blockers.push(`INVALID_CANDIDATE_IDENTITY:${c?.candidateKey ?? "UNKNOWN"}`);
    }
  }
  if (unique(keys).length !== keys.length) blockers.push("DUPLICATE_CANDIDATE_KEY");
  if (anchor?.selectedCandidateKey != null && !keys.includes(anchor.selectedCandidateKey)) blockers.push("SELECTED_CANDIDATE_NOT_IN_FROZEN_SET");

  if (blockers.length) return { ready: false, record: null, blockers: unique(blockers) };

  const frozenAnchor: BusinessForwardAnchor = {
    ...anchor,
    eligibleCandidates: anchor.eligibleCandidates.map((c) => ({ ...c })),
  };

  return {
    ready: true,
    record: {
      version: BUSINESS_FORWARD_JOURNAL_V1,
      semantics: "IMMUTABLE_T0_PLUS_LATER_OUTCOMES",
      anchor: Object.freeze(frozenAnchor),
      outcomes: Object.freeze([]),
      affectsVerdict: false,
      affectsStars: false,
      affectsCandidateAuthority: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
    blockers: [],
  };
}

const ORDER: Record<Exclude<ForwardWindow, "T0">, number> = {
  T_PLUS_3M: 3,
  T_PLUS_6M: 6,
  T_PLUS_15M: 15,
  T_PLUS_30M: 30,
};

export function appendForwardOutcome(record: BusinessForwardJournalRecord, point: ForwardOutcomePoint): { ready: boolean; record: BusinessForwardJournalRecord | null; blockers: string[] } {
  if (record?.version !== BUSINESS_FORWARD_JOURNAL_V1 || record?.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES") {
    return { ready: false, record: null, blockers: ["INVALID_FORWARD_JOURNAL"] };
  }
  if (!(point.window in ORDER) || !Number.isFinite(point.observedAtMs) || point.observedAtMs <= record.anchor.observedAtMs) {
    return { ready: false, record: null, blockers: ["INVALID_FORWARD_OUTCOME_TIMESTAMP_OR_WINDOW"] };
  }
  if (record.outcomes.some((x) => x.window === point.window)) {
    return { ready: false, record: null, blockers: ["DUPLICATE_FORWARD_WINDOW"] };
  }
  const keys = new Set(record.anchor.eligibleCandidates.map((c) => c.candidateKey));
  const observedKeys = Object.keys(point.premiumByCandidateKey ?? {});
  if (observedKeys.some((k) => !keys.has(k))) return { ready: false, record: null, blockers: ["OUTCOME_CANDIDATE_NOT_IN_T0_SET"] };
  if (observedKeys.length === 0 || observedKeys.some((k) => !validPositive(point.premiumByCandidateKey[k]))) {
    return { ready: false, record: null, blockers: ["INVALID_FORWARD_PREMIUM_OBSERVATION"] };
  }

  const next = [...record.outcomes, Object.freeze({ ...point, premiumByCandidateKey: { ...point.premiumByCandidateKey } })]
    .sort((a, b) => ORDER[a.window] - ORDER[b.window]);

  return {
    ready: true,
    record: {
      ...record,
      anchor: record.anchor,
      outcomes: Object.freeze(next),
    },
    blockers: [],
  };
}
