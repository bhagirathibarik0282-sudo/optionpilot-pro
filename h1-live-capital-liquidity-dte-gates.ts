export type LiveGateSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export interface LiveCapitalLiquidityDtePolicy {
  maxCapitalPerTrade: number;
  maxRelativeSpreadPct: number;
  minBidDepthCoverageMultiple: number;
  minAskDepthCoverageMultiple: number;
  allowFallbackDte5To7: boolean;
}

export interface LiveCapitalLiquidityDteEvidence {
  provenance: "LIVE_RUNTIME_EXACT";
  symbol: LiveGateSymbol;
  dte: number;
  premiumLtp: number;
  lotQuantity: number;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  occurredAt: string;
  receivedAt: string;
}

export interface LiveCapitalLiquidityDteResult {
  version: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1";
  capitalFit: boolean;
  liquidityOk: boolean;
  spreadOk: boolean;
  currentOrNearExpiryUsable: boolean;
  higherDteUsable: boolean;
  fallbackDteApproved: boolean;
  reasonCodes: string[];
  failClosed: true;
  semantics: "LIVE_RUNTIME_EXACT_ONLY_NO_INFERENCE";
}

function positive(v: number): boolean { return Number.isFinite(v) && v > 0; }
function validPolicy(p: LiveCapitalLiquidityDtePolicy): boolean {
  return positive(p?.maxCapitalPerTrade) && positive(p?.maxRelativeSpreadPct) &&
    positive(p?.minBidDepthCoverageMultiple) && positive(p?.minAskDepthCoverageMultiple) &&
    typeof p?.allowFallbackDte5To7 === "boolean";
}

export function evaluateLiveCapitalLiquidityDteGates(
  evidence: LiveCapitalLiquidityDteEvidence,
  policy: LiveCapitalLiquidityDtePolicy,
): LiveCapitalLiquidityDteResult {
  const reasons: string[] = [];
  if (evidence?.provenance !== "LIVE_RUNTIME_EXACT") reasons.push("INVALID_PROVENANCE");
  if (!validPolicy(policy)) reasons.push("INVALID_POLICY");
  if (!Number.isInteger(evidence?.dte) || evidence.dte < 0) reasons.push("INVALID_DTE");
  if (!positive(evidence?.premiumLtp) || !Number.isInteger(evidence?.lotQuantity) || evidence.lotQuantity <= 0) reasons.push("INVALID_CAPITAL_INPUT");
  if (!positive(evidence?.bid) || !positive(evidence?.ask) || evidence.ask <= evidence.bid) reasons.push("INVALID_BID_ASK");
  if (!Number.isInteger(evidence?.bidQty) || evidence.bidQty < 0 || !Number.isInteger(evidence?.askQty) || evidence.askQty < 0) reasons.push("INVALID_DEPTH");
  const occurred = Date.parse(evidence?.occurredAt);
  const received = Date.parse(evidence?.receivedAt);
  if (!Number.isFinite(occurred) || !Number.isFinite(received) || occurred > received) reasons.push("INVALID_CHRONOLOGY");

  if (reasons.length > 0) return {
    version: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    capitalFit: false, liquidityOk: false, spreadOk: false,
    currentOrNearExpiryUsable: false, higherDteUsable: false, fallbackDteApproved: false,
    reasonCodes: reasons, failClosed: true, semantics: "LIVE_RUNTIME_EXACT_ONLY_NO_INFERENCE",
  };

  const capitalRequired = evidence.premiumLtp * evidence.lotQuantity;
  const capitalFit = capitalRequired <= policy.maxCapitalPerTrade;
  const mid = (evidence.bid + evidence.ask) / 2;
  const relativeSpreadPct = ((evidence.ask - evidence.bid) / mid) * 100;
  const spreadOk = relativeSpreadPct <= policy.maxRelativeSpreadPct;
  const liquidityOk = evidence.bidQty / evidence.lotQuantity >= policy.minBidDepthCoverageMultiple &&
    evidence.askQty / evidence.lotQuantity >= policy.minAskDepthCoverageMultiple;

  const isWeekly = evidence.symbol === "NIFTY" || evidence.symbol === "SENSEX";
  const currentOrNearExpiryUsable = isWeekly && evidence.dte >= 0 && evidence.dte <= 4;
  const fallbackDteApproved = isWeekly && evidence.dte >= 5 && evidence.dte <= 7 && policy.allowFallbackDte5To7;
  const higherDteUsable = evidence.symbol === "BANKNIFTY" && evidence.dte >= 10 && evidence.dte <= 35;

  if (!capitalFit) reasons.push("CAPITAL_NOT_FIT");
  if (!liquidityOk) reasons.push("LIQUIDITY_NOT_OK");
  if (!spreadOk) reasons.push("SPREAD_NOT_OK");
  if (isWeekly && !(currentOrNearExpiryUsable || fallbackDteApproved)) reasons.push("WEEKLY_DTE_NOT_USABLE");
  if (evidence.symbol === "BANKNIFTY" && !higherDteUsable) reasons.push("BANKNIFTY_DTE_NOT_USABLE");

  return {
    version: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    capitalFit, liquidityOk, spreadOk, currentOrNearExpiryUsable, higherDteUsable, fallbackDteApproved,
    reasonCodes: reasons.length ? reasons : ["LIVE_CAPITAL_LIQUIDITY_DTE_GATES_PASSED"],
    failClosed: true,
    semantics: "LIVE_RUNTIME_EXACT_ONLY_NO_INFERENCE",
  };
}
