import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";

export type ReconstructionState = "RECONSTRUCTABLE" | "PARTIAL" | "NOT_RECORDED";

export interface CandidateGateAuditRow {
  gate: string;
  state: ReconstructionState;
  evidence: string[];
  note: string;
}

export interface H1CandidateReconstructionAuditResult {
  mode: "READ_ONLY_H1_CANDIDATE_RECONSTRUCTION_AUDIT_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  totalOptionRows: number;
  gates: CandidateGateAuditRow[];
  reconstructableGateCount: number;
  partialGateCount: number;
  notRecordedGateCount: number;
  fullSelectorReconstructionPossible: false;
  blockers: string[];
  semantics: "AUDIT_ONLY_DO_NOT_INFER_EXECUTION_SELECTOR_QUALIFICATION";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

export function auditCandidateReconstruction(
  request: H1ReplayRequest,
  replay: H1ReplayHttpResult,
): H1CandidateReconstructionAuditResult {
  const rows = replay.options ?? [];
  const gates: CandidateGateAuditRow[] = [
    { gate: "contract_identity", state: "RECONSTRUCTABLE", evidence: ["expiry", "strike", "option_type", "dte"], note: "Recorded directly in H1 option rows." },
    { gate: "moneyness", state: "RECONSTRUCTABLE", evidence: ["atm_offset"], note: "ATM can be proven from atm_offset=0; ITM1 can be derived only with side-aware offset semantics already used by recorder." },
    { gate: "premium_ltp", state: "RECONSTRUCTABLE", evidence: ["ltp"], note: "Recorded directly." },
    { gate: "liquidity_ok", state: "PARTIAL", evidence: ["liquidity_status", "volume", "oi"], note: "Liquidity state exists, but selector boolean policy is not persisted as an authoritative gate decision." },
    { gate: "spread_ok", state: "PARTIAL", evidence: ["spread", "bid", "ask"], note: "Spread data exists, but selector threshold/boolean result is not persisted." },
    { gate: "capital_fit", state: "NOT_RECORDED", evidence: [], note: "Capital available / per-trade allocation is not stored in H1 option rows." },
    { gate: "premium_response_confirmed", state: "NOT_RECORDED", evidence: [], note: "Deterministic premium-response gate result is not persisted in H1 replay." },
    { gate: "delta_gamma_response_confirmed", state: "NOT_RECORDED", evidence: ["delta", "gamma"], note: "Greeks exist, but the selector confirmation boolean and rule context are not persisted." },
    { gate: "theta_iv_burden_acceptable", state: "PARTIAL", evidence: ["theta", "iv", "extrinsic", "dte"], note: "Inputs exist, but the selector acceptance decision/thresholds at signal time are not persisted." },
    { gate: "multi_expiry_conflict_absent", state: "NOT_RECORDED", evidence: ["expiry", "expiry_bucket"], note: "Multi-expiry rows exist, but the conflict-resolution verdict is not persisted." },
    { gate: "current_or_near_expiry_usable", state: "NOT_RECORDED", evidence: ["dte", "expiry_bucket"], note: "Usability verdict is not persisted." },
    { gate: "higher_dte_usable", state: "NOT_RECORDED", evidence: ["dte", "expiry_bucket"], note: "BANKNIFTY higher-DTE usability verdict is not persisted." },
    { gate: "fallback_dte_approved", state: "NOT_RECORDED", evidence: ["dte"], note: "Required for NIFTY/SENSEX DTE 5-7 but approval boolean is not persisted." },
  ];

  const reconstructableGateCount = gates.filter(g => g.state === "RECONSTRUCTABLE").length;
  const partialGateCount = gates.filter(g => g.state === "PARTIAL").length;
  const notRecordedGateCount = gates.filter(g => g.state === "NOT_RECORDED").length;
  const blockers = ["FULL_EXECUTION_SELECTOR_RECONSTRUCTION_NOT_POSSIBLE_FROM_H1_REPLAY_FIELDS"];
  if (!replay.ok) blockers.unshift(replay.reason ?? "H1_REPLAY_UNAVAILABLE");

  return {
    mode: "READ_ONLY_H1_CANDIDATE_RECONSTRUCTION_AUDIT_V1",
    productionImpact: "NONE",
    request,
    totalOptionRows: rows.length,
    gates,
    reconstructableGateCount,
    partialGateCount,
    notRecordedGateCount,
    fullSelectorReconstructionPossible: false,
    blockers,
    semantics: "AUDIT_ONLY_DO_NOT_INFER_EXECUTION_SELECTOR_QUALIFICATION",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
