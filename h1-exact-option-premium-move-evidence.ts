import type { H1LiveExactRawEvidenceRow } from "./h1-live-exact-raw-evidence-store.js";

export interface H1ExactOptionPremiumMovePolicy {
  maxObservationGapMs: number;
}

export interface H1ExactOptionPremiumMoveEvidence {
  version: "H1_EXACT_OPTION_PREMIUM_MOVE_EVIDENCE_V1";
  ready: boolean;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" | null;
  instrumentToken: number | null;
  expiry: string | null;
  strike: number | null;
  side: "CE" | "PE" | null;
  previousObservedAt: string | null;
  currentObservedAt: string | null;
  previousLtp: number | null;
  currentLtp: number | null;
  premiumMovePct: number | null;
  blockers: string[];
  semantics: "EXACT_SAME_TOKEN_PREMIUM_MOVE_ONLY_NO_DIRECTION_MAPPING";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function blocked(blockers: string[]): H1ExactOptionPremiumMoveEvidence {
  return {
    version: "H1_EXACT_OPTION_PREMIUM_MOVE_EVIDENCE_V1",
    ready: false,
    symbol: null,
    instrumentToken: null,
    expiry: null,
    strike: null,
    side: null,
    previousObservedAt: null,
    currentObservedAt: null,
    previousLtp: null,
    currentLtp: null,
    premiumMovePct: null,
    blockers: [...new Set(blockers)],
    semantics: "EXACT_SAME_TOKEN_PREMIUM_MOVE_ONLY_NO_DIRECTION_MAPPING",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}

function validOptionRow(row: H1LiveExactRawEvidenceRow | null | undefined): row is H1LiveExactRawEvidenceRow {
  return !!row && row.role === "OPTION" &&
    (row.symbol === "NIFTY" || row.symbol === "SENSEX" || row.symbol === "BANKNIFTY") &&
    Number.isInteger(row.instrumentToken) && row.instrumentToken > 0 &&
    typeof row.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.expiry) &&
    Number.isFinite(row.strike) && Number(row.strike) > 0 &&
    (row.optionSide === "CE" || row.optionSide === "PE") &&
    Number.isFinite(Date.parse(row.observedAt)) &&
    Number.isFinite(row.ltp) && row.ltp > 0;
}

export function buildH1ExactOptionPremiumMoveEvidence(
  previous: H1LiveExactRawEvidenceRow | null,
  current: H1LiveExactRawEvidenceRow | null,
  policy: H1ExactOptionPremiumMovePolicy,
): H1ExactOptionPremiumMoveEvidence {
  const blockers: string[] = [];
  if (!validOptionRow(previous)) blockers.push("INVALID_PREVIOUS_EXACT_OPTION_EVIDENCE");
  if (!validOptionRow(current)) blockers.push("INVALID_CURRENT_EXACT_OPTION_EVIDENCE");
  if (!policy || !Number.isFinite(policy.maxObservationGapMs) || policy.maxObservationGapMs <= 0) {
    blockers.push("INVALID_PREMIUM_MOVE_POLICY");
  }
  if (blockers.length > 0 || !previous || !current) return blocked(blockers);

  if (previous.instrumentToken !== current.instrumentToken ||
      previous.symbol !== current.symbol || previous.expiry !== current.expiry ||
      previous.strike !== current.strike || previous.optionSide !== current.optionSide) {
    return blocked(["EXACT_OPTION_IDENTITY_MISMATCH"]);
  }

  const previousMs = Date.parse(previous.observedAt);
  const currentMs = Date.parse(current.observedAt);
  const gap = currentMs - previousMs;
  if (gap <= 0) return blocked(["NON_FORWARD_CHRONOLOGY"]);
  if (gap > policy.maxObservationGapMs) return blocked(["OBSERVATION_GAP_TOO_LARGE"]);

  const premiumMovePct = ((current.ltp - previous.ltp) / previous.ltp) * 100;
  return {
    version: "H1_EXACT_OPTION_PREMIUM_MOVE_EVIDENCE_V1",
    ready: true,
    symbol: current.symbol,
    instrumentToken: current.instrumentToken,
    expiry: current.expiry,
    strike: current.strike,
    side: current.optionSide,
    previousObservedAt: previous.observedAt,
    currentObservedAt: current.observedAt,
    previousLtp: previous.ltp,
    currentLtp: current.ltp,
    premiumMovePct,
    blockers: [],
    semantics: "EXACT_SAME_TOKEN_PREMIUM_MOVE_ONLY_NO_DIRECTION_MAPPING",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
