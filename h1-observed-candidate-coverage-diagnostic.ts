import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";

export interface H1ObservedCandidateCoverageDiagnostic {
  mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_COVERAGE_DIAGNOSTIC_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  totalOptionRows: number;
  candidateTrue: number;
  candidateFalse: number;
  candidateNullish: number;
  truthTrueCandidateRows: number;
  positiveAskCandidateRows: number;
  exactPlus30ExitAvailableRows: number;
  exactPlus30PositiveBidRows: number;
  validationStatusCounts: Record<string, number>;
  liquidityStatusCounts: Record<string, number>;
  dteCounts: Record<string, number>;
  blockers: string[];
  semantics: "DIAGNOSTIC_ONLY_NO_SELECTOR_OR_EDGE_CLAIM";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const s = (v: unknown): string => typeof v === "string" ? v : String(v ?? "");
const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const b = (v: unknown): boolean => v === true || v === "true";
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function diagnoseObservedCandidateCoverage(request: H1ReplayRequest, replay: H1ReplayHttpResult): H1ObservedCandidateCoverageDiagnostic {
  const rows = replay.options ?? [];
  const validationStatusCounts: Record<string, number> = {};
  const liquidityStatusCounts: Record<string, number> = {};
  const dteCounts: Record<string, number> = {};
  let candidateTrue = 0;
  let candidateFalse = 0;
  let candidateNullish = 0;
  let truthTrueCandidateRows = 0;
  let positiveAskCandidateRows = 0;
  let exactPlus30ExitAvailableRows = 0;
  let exactPlus30PositiveBidRows = 0;

  const byContract = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    bump(validationStatusCounts, s(row.validation_status) || "NULL");
    bump(liquidityStatusCounts, s(row.liquidity_status) || "NULL");
    bump(dteCounts, String(n(row.dte) ?? "NULL"));
    const key = `${s(row.expiry)}|${n(row.strike)}|${s(row.option_type)}`;
    const arr = byContract.get(key) ?? [];
    arr.push(row);
    byContract.set(key, arr);
  }

  for (const row of rows) {
    if (row.is_candidate == null) candidateNullish++;
    else if (b(row.is_candidate)) candidateTrue++;
    else candidateFalse++;

    if (!b(row.is_candidate) || s(row.truth_verdict) !== "TRUE") continue;
    truthTrueCandidateRows++;
    const ask = n(row.ask);
    if (ask == null || ask <= 0) continue;
    positiveAskCandidateRows++;

    const signalMs = Date.parse(s(row.minute_bucket));
    if (!Number.isFinite(signalMs)) continue;
    const targetMs = signalMs + 30 * 60_000;
    const key = `${s(row.expiry)}|${n(row.strike)}|${s(row.option_type)}`;
    const exact = (byContract.get(key) ?? []).filter(x => Date.parse(s(x.minute_bucket)) === targetMs && s(x.truth_verdict) === "TRUE");
    if (exact.length !== 1) continue;
    exactPlus30ExitAvailableRows++;
    const bid = n(exact[0].bid);
    if (bid != null && bid > 0) exactPlus30PositiveBidRows++;
  }

  const blockers: string[] = [];
  if (!replay.ok) blockers.push(replay.reason ?? "H1_REPLAY_UNAVAILABLE");
  if (candidateTrue === 0) blockers.push("NO_IS_CANDIDATE_TRUE_ROWS");
  else if (truthTrueCandidateRows === 0) blockers.push("CANDIDATES_NOT_TRUTH_TRUE");
  else if (positiveAskCandidateRows === 0) blockers.push("CANDIDATES_HAVE_NO_POSITIVE_ASK");
  else if (exactPlus30ExitAvailableRows === 0) blockers.push("NO_EXACT_PLUS30_EXIT_ROW");
  else if (exactPlus30PositiveBidRows === 0) blockers.push("EXACT_PLUS30_EXIT_BID_NOT_POSITIVE");

  return {
    mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_COVERAGE_DIAGNOSTIC_V1",
    productionImpact: "NONE",
    request,
    totalOptionRows: rows.length,
    candidateTrue,
    candidateFalse,
    candidateNullish,
    truthTrueCandidateRows,
    positiveAskCandidateRows,
    exactPlus30ExitAvailableRows,
    exactPlus30PositiveBidRows,
    validationStatusCounts,
    liquidityStatusCounts,
    dteCounts,
    blockers,
    semantics: "DIAGNOSTIC_ONLY_NO_SELECTOR_OR_EDGE_CLAIM",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
