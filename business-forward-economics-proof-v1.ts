import type { BusinessExactEconomicsResult } from "./business-exact-economics-v1.js";
import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";

export const BUSINESS_FORWARD_ECONOMICS_PROOF_V1 = "BUSINESS_FORWARD_ECONOMICS_PROOF_V1" as const;

export interface CandidateEconomicsObservation {
  candidateKey: string;
  contractKey: string;
  premiumMovePct: number;
  thetaBurdenPctOfPremium: number;
  relativeSpreadPct: number;
  bidDepthCoverageMultiple: number;
  askDepthCoverageMultiple: number;
  depthImbalance: number;
  microprice: number;
  midprice: number;
  micropricePressure: number;
  observedAt: string;
}

export interface BusinessForwardEconomicsProof {
  version: typeof BUSINESS_FORWARD_ECONOMICS_PROOF_V1;
  ready: boolean;
  journalDecisionId: string | null;
  snapshotId: string | null;
  economicsByCandidateKey: Readonly<Record<string, Readonly<CandidateEconomicsObservation>>>;
  blockers: string[];
  semantics: "READ_ONLY_T0_EXACT_ECONOMICS_ATTACHMENT";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  semantics: "READ_ONLY_T0_EXACT_ECONOMICS_ATTACHMENT" as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function contractKeyFromJournalCandidate(c: BusinessForwardJournalRecord["anchor"]["eligibleCandidates"][number]): string {
  return [c.symbol, c.optionSide, c.strike, c.expiryDate, `DTE${c.dte}`].join(":");
}

function validEconomics(x: BusinessExactEconomicsResult): boolean {
  return !!x && x.ready === true &&
    x.version === "BUSINESS_EXACT_ECONOMICS_V1" &&
    typeof x.candidateKey === "string" && x.candidateKey.length > 0 &&
    typeof x.observedAt === "string" && Number.isFinite(Date.parse(x.observedAt)) &&
    [
      x.premiumMovePct,
      x.thetaBurdenPctOfPremium,
      x.relativeSpreadPct,
      x.bidDepthCoverageMultiple,
      x.askDepthCoverageMultiple,
      x.depthImbalance,
      x.microprice,
      x.midprice,
      x.micropricePressure,
    ].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    x.semantics === "RESEARCH_SHADOW_ONLY" &&
    x.affectsVerdict === false &&
    x.affectsStars === false &&
    x.affectsCandidateAuthority === false &&
    x.affectsTelegram === false &&
    x.affectsExecution === false &&
    x.createsOrders === false &&
    x.failClosed === true;
}

export function attachExactEconomicsToForwardJournal(
  journal: BusinessForwardJournalRecord,
  economics: BusinessExactEconomicsResult[],
): BusinessForwardEconomicsProof {
  const blockers: string[] = [];

  if (!journal || journal.version !== "BUSINESS_FORWARD_JOURNAL_V1" || journal.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES") {
    blockers.push("VALID_FORWARD_JOURNAL_REQUIRED");
  }
  if (!Array.isArray(economics) || economics.length === 0) blockers.push("EXACT_ECONOMICS_REQUIRED");
  if (Array.isArray(economics) && economics.some((x) => !validEconomics(x))) blockers.push("INVALID_EXACT_ECONOMICS");

  if (blockers.length) {
    return {
      version: BUSINESS_FORWARD_ECONOMICS_PROOF_V1,
      ready: false,
      journalDecisionId: null,
      snapshotId: null,
      economicsByCandidateKey: Object.freeze({}),
      blockers: [...new Set(blockers)],
      ...SAFETY,
    };
  }

  const byContractKey = new Map<string, BusinessExactEconomicsResult>();
  for (const row of economics) {
    if (byContractKey.has(row.candidateKey!)) {
      blockers.push(`DUPLICATE_ECONOMICS_CONTRACT:${row.candidateKey}`);
      continue;
    }
    byContractKey.set(row.candidateKey!, row);
  }

  const attached: Record<string, Readonly<CandidateEconomicsObservation>> = {};
  for (const c of journal.anchor.eligibleCandidates) {
    const contractKey = contractKeyFromJournalCandidate(c);
    const row = byContractKey.get(contractKey);
    if (!row) continue;

    const observedMs = Date.parse(row.observedAt!);
    if (observedMs > journal.anchor.observedAtMs) {
      blockers.push(`ECONOMICS_AFTER_T0:${c.candidateKey}`);
      continue;
    }

    attached[c.candidateKey] = Object.freeze({
      candidateKey: c.candidateKey,
      contractKey,
      premiumMovePct: row.premiumMovePct!,
      thetaBurdenPctOfPremium: row.thetaBurdenPctOfPremium!,
      relativeSpreadPct: row.relativeSpreadPct!,
      bidDepthCoverageMultiple: row.bidDepthCoverageMultiple!,
      askDepthCoverageMultiple: row.askDepthCoverageMultiple!,
      depthImbalance: row.depthImbalance!,
      microprice: row.microprice!,
      midprice: row.midprice!,
      micropricePressure: row.micropricePressure!,
      observedAt: row.observedAt!,
    });
  }

  if (Object.keys(attached).length === 0) blockers.push("NO_T0_CANDIDATE_ECONOMICS_MATCH");

  return {
    version: BUSINESS_FORWARD_ECONOMICS_PROOF_V1,
    ready: blockers.length === 0,
    journalDecisionId: journal.anchor.decisionId,
    snapshotId: journal.anchor.snapshotId,
    economicsByCandidateKey: Object.freeze(attached),
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}
