import type { BusinessForwardJournalRecord, ForwardOutcomePoint } from "./business-forward-journal-v1.js";

export const BUSINESS_FORWARD_KPI_V1 = "BUSINESS_FORWARD_KPI_V1" as const;

export interface CandidateForwardKpi {
  candidateKey: string;
  t0Premium: number;
  observedWindows: number;
  terminalWindow: ForwardOutcomePoint["window"] | null;
  terminalPremium: number | null;
  terminalReturnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
}

export interface BusinessForwardKpiResult {
  version: typeof BUSINESS_FORWARD_KPI_V1;
  ready: boolean;
  sampleCandidateCount: number;
  completedWindowCount: number;
  terminalWindow: ForwardOutcomePoint["window"] | null;
  candidateKpis: ReadonlyArray<Readonly<CandidateForwardKpi>>;
  bestCandidateKeyByTerminalReturn: string | null;
  bestTerminalReturnPct: number | null;
  selectedCandidateKey: string | null;
  selectedTerminalReturnPct: number | null;
  selectedRank: number | null;
  selectedRankPercentile: number | null;
  selectionRegretPct: number | null;
  blockers: string[];
  semantics: "POST_T0_FORWARD_EVIDENCE_ANALYTICS_ONLY";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  semantics: "POST_T0_FORWARD_EVIDENCE_ANALYTICS_ONLY" as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

const ORDER: Record<ForwardOutcomePoint["window"], number> = {
  T_PLUS_3M: 3,
  T_PLUS_6M: 6,
  T_PLUS_15M: 15,
  T_PLUS_30M: 30,
};

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

function pct(t0: number, value: number): number {
  return ((value - t0) / t0) * 100;
}

function invalidJournal(journal: BusinessForwardJournalRecord): boolean {
  return !journal ||
    journal.version !== "BUSINESS_FORWARD_JOURNAL_V1" ||
    journal.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES" ||
    !journal.anchor ||
    !Array.isArray(journal.anchor.eligibleCandidates) ||
    journal.anchor.eligibleCandidates.length === 0 ||
    !Array.isArray(journal.outcomes);
}

/**
 * Post-T0 research analytics only.
 *
 * For a long option buyer:
 * - MFE = largest premium return observed after T0.
 * - MAE = smallest premium return observed after T0.
 * - selection regret = best eligible terminal return - selected terminal return.
 *
 * This function never feeds results back into the same T0 decision.
 */
export function computeBusinessForwardKpis(
  journal: BusinessForwardJournalRecord,
): BusinessForwardKpiResult {
  const blockers: string[] = [];

  if (invalidJournal(journal)) blockers.push("VALID_FORWARD_JOURNAL_REQUIRED");
  if (blockers.length === 0 && journal.outcomes.length === 0) blockers.push("FORWARD_OUTCOMES_REQUIRED");

  if (blockers.length > 0) {
    return {
      version: BUSINESS_FORWARD_KPI_V1,
      ready: false,
      sampleCandidateCount: 0,
      completedWindowCount: 0,
      terminalWindow: null,
      candidateKpis: Object.freeze([]),
      bestCandidateKeyByTerminalReturn: null,
      bestTerminalReturnPct: null,
      selectedCandidateKey: journal?.anchor?.selectedCandidateKey ?? null,
      selectedTerminalReturnPct: null,
      selectedRank: null,
      selectedRankPercentile: null,
      selectionRegretPct: null,
      blockers: [...new Set(blockers)],
      ...SAFETY,
    };
  }

  const outcomes = [...journal.outcomes].sort((a, b) => ORDER[a.window] - ORDER[b.window]);
  const terminal = outcomes[outcomes.length - 1];
  const terminalWindow = terminal?.window ?? null;

  const candidateKpis: CandidateForwardKpi[] = journal.anchor.eligibleCandidates.map((candidate) => {
    const returns: number[] = [];
    let terminalPremium: number | null = null;
    let lastWindow: ForwardOutcomePoint["window"] | null = null;

    for (const point of outcomes) {
      const premium = point.premiumByCandidateKey[candidate.candidateKey];
      if (typeof premium !== "number" || !Number.isFinite(premium) || premium <= 0) continue;
      returns.push(pct(candidate.premiumLtp, premium));
      terminalPremium = premium;
      lastWindow = point.window;
    }

    if (returns.length === 0 || terminalPremium == null || lastWindow == null) {
      return {
        candidateKey: candidate.candidateKey,
        t0Premium: candidate.premiumLtp,
        observedWindows: 0,
        terminalWindow: null,
        terminalPremium: null,
        terminalReturnPct: null,
        mfePct: null,
        maePct: null,
      };
    }

    return {
      candidateKey: candidate.candidateKey,
      t0Premium: candidate.premiumLtp,
      observedWindows: returns.length,
      terminalWindow: lastWindow,
      terminalPremium: round4(terminalPremium),
      terminalReturnPct: round4(returns[returns.length - 1]),
      mfePct: round4(Math.max(...returns)),
      maePct: round4(Math.min(...returns)),
    };
  });

  const ranked = candidateKpis
    .filter((x) => x.terminalReturnPct != null)
    .sort((a, b) => (b.terminalReturnPct! - a.terminalReturnPct!) || a.candidateKey.localeCompare(b.candidateKey));

  if (ranked.length === 0) blockers.push("NO_CANDIDATE_HAS_FORWARD_PREMIUM_OUTCOME");

  const best = ranked[0] ?? null;
  const selectedKey = journal.anchor.selectedCandidateKey;
  const selected = selectedKey ? ranked.find((x) => x.candidateKey === selectedKey) ?? null : null;

  let selectedRank: number | null = null;
  let selectedRankPercentile: number | null = null;
  let selectionRegretPct: number | null = null;

  if (selected) {
    selectedRank = ranked.findIndex((x) => x.candidateKey === selected.candidateKey) + 1;
    selectedRankPercentile = ranked.length === 1
      ? 100
      : round4(((ranked.length - selectedRank) / (ranked.length - 1)) * 100);
    selectionRegretPct = best
      ? round4(best.terminalReturnPct! - selected.terminalReturnPct!)
      : null;
  }

  return {
    version: BUSINESS_FORWARD_KPI_V1,
    ready: blockers.length === 0,
    sampleCandidateCount: ranked.length,
    completedWindowCount: outcomes.length,
    terminalWindow,
    candidateKpis: Object.freeze(candidateKpis.map((x) => Object.freeze({ ...x }))),
    bestCandidateKeyByTerminalReturn: best?.candidateKey ?? null,
    bestTerminalReturnPct: best?.terminalReturnPct ?? null,
    selectedCandidateKey: selectedKey,
    selectedTerminalReturnPct: selected?.terminalReturnPct ?? null,
    selectedRank,
    selectedRankPercentile,
    selectionRegretPct,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}
