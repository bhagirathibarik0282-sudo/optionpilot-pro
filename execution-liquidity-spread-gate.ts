export type LiquiditySpreadDecision = "ALLOW" | "BLOCK";

export interface LiquiditySpreadPolicy {
  maxQuoteAgeMs: number;
  maxRelativeSpreadPct: number;
  minAskDepthCoverageMultiple: number;
  minBidDepthCoverageMultiple: number;
}

export interface LiquiditySpreadInput {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  orderQty: number;
  quoteAgeMs: number;
  policy: LiquiditySpreadPolicy;
}

export interface LiquiditySpreadResult {
  version: "EXECUTION_LIQUIDITY_SPREAD_GATE_V1";
  decision: LiquiditySpreadDecision;
  relativeSpreadPct: number | null;
  askDepthCoverage: number | null;
  bidDepthCoverage: number | null;
  reasonCodes: string[];
  failClosed: true;
}

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function validPolicy(p: LiquiditySpreadPolicy): boolean {
  return Number.isFinite(p?.maxQuoteAgeMs) && p.maxQuoteAgeMs >= 0 &&
    finitePositive(p?.maxRelativeSpreadPct) &&
    finitePositive(p?.minAskDepthCoverageMultiple) &&
    finitePositive(p?.minBidDepthCoverageMultiple);
}

export function evaluateLiquiditySpreadGate(input: LiquiditySpreadInput): LiquiditySpreadResult {
  const reasons: string[] = [];

  if (!validPolicy(input?.policy)) reasons.push("INVALID_LIQUIDITY_POLICY");
  if (!finitePositive(input?.bid) || !finitePositive(input?.ask) || input.ask <= input.bid) reasons.push("INVALID_BID_ASK");
  if (!Number.isInteger(input?.bidQty) || input.bidQty < 0 || !Number.isInteger(input?.askQty) || input.askQty < 0) reasons.push("INVALID_DEPTH_QUANTITY");
  if (!Number.isInteger(input?.orderQty) || input.orderQty <= 0) reasons.push("INVALID_ORDER_QUANTITY");
  if (!Number.isFinite(input?.quoteAgeMs) || input.quoteAgeMs < 0) reasons.push("INVALID_QUOTE_AGE");

  let relativeSpreadPct: number | null = null;
  let askDepthCoverage: number | null = null;
  let bidDepthCoverage: number | null = null;

  if (reasons.length === 0) {
    const mid = (input.bid + input.ask) / 2;
    relativeSpreadPct = ((input.ask - input.bid) / mid) * 100;
    askDepthCoverage = input.askQty / input.orderQty;
    bidDepthCoverage = input.bidQty / input.orderQty;

    if (input.quoteAgeMs > input.policy.maxQuoteAgeMs) reasons.push("QUOTE_STALE");
    if (relativeSpreadPct > input.policy.maxRelativeSpreadPct) reasons.push("SPREAD_TOO_WIDE");
    if (askDepthCoverage < input.policy.minAskDepthCoverageMultiple) reasons.push("INSUFFICIENT_ENTRY_DEPTH");
    if (bidDepthCoverage < input.policy.minBidDepthCoverageMultiple) reasons.push("INSUFFICIENT_EXIT_DEPTH");
  }

  return {
    version: "EXECUTION_LIQUIDITY_SPREAD_GATE_V1",
    decision: reasons.length === 0 ? "ALLOW" : "BLOCK",
    relativeSpreadPct,
    askDepthCoverage,
    bidDepthCoverage,
    reasonCodes: reasons.length === 0 ? ["LIQUIDITY_SPREAD_GATE_PASSED"] : reasons,
    failClosed: true,
  };
}
