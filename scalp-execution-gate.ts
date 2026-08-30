// Condition-driven scalp execution gate for NIFTY/SENSEX weekly option buying.
// Pure decision logic only: no broker/network side effects and no wall-clock reads.

export type ScalpExecutionDecision = "ALLOW" | "BLOCK";
export type ScalpIndex = "NIFTY" | "SENSEX";

export interface ScalpExecutionPolicy {
  openingNoEntryUntil: string; // HH:MM IST, default intended 09:20
  lateStrictFrom: string;      // HH:MM IST, default intended 15:00
  noFreshEntryFrom: string;    // HH:MM IST, default intended 15:10
  expiryDayNoFreshEntryFrom: string; // HH:MM IST, initial safety default 14:45
  minCooldownSeconds: number;
}

export interface ScalpExecutionInput {
  symbol: ScalpIndex;
  marketTimeIst: string; // HH:MM
  isExpiryDay: boolean;
  nearestWeeklyDte: number;
  nearestDteUsable: boolean;
  liquidityOk: boolean;
  spreadOk: boolean;
  dataFresh: boolean;
  setupFresh: boolean;
  setupId: string;
  previousSetupId: string | null;
  secondsSincePreviousExit: number | null;
  activeIndexPosition: ScalpIndex | null;
  niftyScore: number;
  sensexScore: number;
  minScoreGap: number;
  allRiskGatesPassed: boolean;
  policy: ScalpExecutionPolicy;
}

export interface ScalpExecutionGateResult {
  version: "SCALP_EXECUTION_GATE_V1";
  decision: ScalpExecutionDecision;
  reasonCodes: string[];
  winner: ScalpIndex | null;
  strictWindow: boolean;
  failClosed: true;
}

function validTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function mins(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function evaluateScalpExecutionGate(input: ScalpExecutionInput): ScalpExecutionGateResult {
  const reasons: string[] = [];
  const policy = input?.policy;

  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") reasons.push("INVALID_SCALP_SYMBOL");
  if (!validTime(input?.marketTimeIst)) reasons.push("INVALID_MARKET_TIME_IST");
  if (!policy || !validTime(policy.openingNoEntryUntil) || !validTime(policy.lateStrictFrom) ||
      !validTime(policy.noFreshEntryFrom) || !validTime(policy.expiryDayNoFreshEntryFrom)) {
    reasons.push("INVALID_TIME_POLICY");
  }
  if (!policy || !finiteNonNegative(policy.minCooldownSeconds)) reasons.push("INVALID_COOLDOWN_POLICY");
  if (!Number.isInteger(input?.nearestWeeklyDte) || input.nearestWeeklyDte < 0) reasons.push("INVALID_NEAREST_WEEKLY_DTE");
  if (!Number.isFinite(input?.niftyScore) || !Number.isFinite(input?.sensexScore) ||
      !finiteNonNegative(input?.minScoreGap)) reasons.push("INVALID_INDEX_SCORE_CONTEXT");
  if (typeof input?.setupId !== "string" || input.setupId.trim().length === 0) reasons.push("INVALID_SETUP_ID");

  if (reasons.length > 0) {
    return { version: "SCALP_EXECUTION_GATE_V1", decision: "BLOCK", reasonCodes: reasons, winner: null, strictWindow: false, failClosed: true };
  }

  const now = mins(input.marketTimeIst);
  const openingEnd = mins(policy.openingNoEntryUntil);
  const strictFrom = mins(policy.lateStrictFrom);
  const noFreshFrom = mins(policy.noFreshEntryFrom);
  const expiryNoFreshFrom = mins(policy.expiryDayNoFreshEntryFrom);
  const strictWindow = now >= strictFrom;

  if (now < openingEnd) reasons.push("OPENING_STABILIZATION_NO_ENTRY");
  if (now >= noFreshFrom) reasons.push("NO_FRESH_SCALP_ENTRY_TIME_REACHED");
  if (input.isExpiryDay && now >= expiryNoFreshFrom) reasons.push("EXPIRY_DAY_FRESH_ENTRY_CUTOFF_REACHED");

  if (!input.dataFresh) reasons.push("DATA_NOT_FRESH");
  if (!input.nearestDteUsable) reasons.push("NEAREST_WEEKLY_DTE_NOT_USABLE");
  if (!input.liquidityOk) reasons.push("LIQUIDITY_GATE_FAILED");
  if (!input.spreadOk) reasons.push("SPREAD_GATE_FAILED");
  if (!input.allRiskGatesPassed) reasons.push("RISK_GATES_NOT_PASSED");
  if (!input.setupFresh) reasons.push("SETUP_NOT_FRESH");
  if (input.previousSetupId != null && input.previousSetupId === input.setupId) reasons.push("DUPLICATE_SETUP_ID");

  if (input.activeIndexPosition != null) {
    reasons.push(input.activeIndexPosition === "NIFTY" ? "NIFTY_ACTIVE_SENSEX_LOCKED" : "SENSEX_ACTIVE_NIFTY_LOCKED");
  }

  if (input.secondsSincePreviousExit != null) {
    if (!finiteNonNegative(input.secondsSincePreviousExit)) reasons.push("INVALID_SECONDS_SINCE_PREVIOUS_EXIT");
    else if (input.secondsSincePreviousExit < policy.minCooldownSeconds) reasons.push("COOLDOWN_NOT_COMPLETED");
  }

  const gap = Math.abs(input.niftyScore - input.sensexScore);
  const winner: ScalpIndex | null = gap >= input.minScoreGap
    ? (input.niftyScore > input.sensexScore ? "NIFTY" : "SENSEX")
    : null;

  if (!winner) reasons.push("INDEX_SCORES_TOO_CLOSE_NO_TRADE");
  else if (winner !== input.symbol) reasons.push("OTHER_INDEX_HAS_STRONGER_SETUP");

  // Late-session trades must already pass every quality/risk input above; this flag is surfaced
  // so downstream policy can require stricter thresholds without changing this deterministic gate.
  if (strictWindow && reasons.length === 0) reasons.push("LATE_STRICT_WINDOW_PASSED");

  const allow = reasons.length === 0 || (reasons.length === 1 && reasons[0] === "LATE_STRICT_WINDOW_PASSED");
  return {
    version: "SCALP_EXECUTION_GATE_V1",
    decision: allow ? "ALLOW" : "BLOCK",
    reasonCodes: allow ? (strictWindow ? ["LATE_STRICT_WINDOW_PASSED"] : ["SCALP_EXECUTION_GATE_PASSED"]) : reasons,
    winner: allow ? winner : winner,
    strictWindow,
    failClosed: true,
  };
}
