export type LiveModelAuditState = "VERIFIED" | "PARTIAL" | "BLOCKED";

export interface LiveOptionModelSourceAudit {
  state: LiveModelAuditState;
  hasIvSolverMarker: boolean;
  hasGreekMarker: boolean;
  hasRateMarker: boolean;
  hasDividendMarker: boolean;
  hasTimeMarker: boolean;
  hasModelMathMarker: boolean;
  reasons: string[];
  auditVersion: "LIVE_OPTION_MODEL_SOURCE_AUDIT_V1";
}

const has = (source: string, re: RegExp) => re.test(source);

/**
 * Static source audit only. It never upgrades live model permission by itself.
 * VERIFIED means the required source markers are present for a later parity audit,
 * not that numerical parity has already been proven.
 */
export function auditLiveOptionModelSource(source: string): LiveOptionModelSourceAudit {
  const hasIvSolverMarker = has(source, /(implied\s*vol|impliedVol|solve\w*IV|calculate\w*IV|compute\w*IV|bisection|newton)/i);
  const hasGreekMarker = has(source, /(delta|gamma|vega|theta)/i);
  const hasRateMarker = has(source, /(risk.?free|interest.?rate|\br\s*=\s*0\.0|RISK_FREE)/i);
  const hasDividendMarker = has(source, /(dividend|yield|\bq\s*=\s*0(?:\D|$))/i);
  const hasTimeMarker = has(source, /(time.?to.?expiry|years.?to.?expiry|DTE|365|252)/i);
  const hasModelMathMarker = has(source, /(Math\.log\([^\n]*\/[^\n]*\)|d1\b|d2\b|normalCdf|normCdf|Black.?Scholes)/i);

  const reasons: string[] = [];
  if (!hasIvSolverMarker) reasons.push("IV_SOLVER_NOT_LOCATED");
  if (!hasGreekMarker) reasons.push("GREEK_CALCULATION_NOT_LOCATED");
  if (!hasRateMarker) reasons.push("RATE_ASSUMPTION_NOT_LOCATED");
  if (!hasDividendMarker) reasons.push("DIVIDEND_ASSUMPTION_NOT_LOCATED");
  if (!hasTimeMarker) reasons.push("TIME_CONVENTION_NOT_LOCATED");
  if (!hasModelMathMarker) reasons.push("MODEL_MATH_NOT_LOCATED");

  const count = [hasIvSolverMarker,hasGreekMarker,hasRateMarker,hasDividendMarker,hasTimeMarker,hasModelMathMarker].filter(Boolean).length;
  return {
    state: count === 6 ? "VERIFIED" : count >= 3 ? "PARTIAL" : "BLOCKED",
    hasIvSolverMarker, hasGreekMarker, hasRateMarker, hasDividendMarker, hasTimeMarker, hasModelMathMarker,
    reasons,
    auditVersion: "LIVE_OPTION_MODEL_SOURCE_AUDIT_V1",
  };
}
