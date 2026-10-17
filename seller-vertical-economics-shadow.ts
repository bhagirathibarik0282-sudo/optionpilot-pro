/** Read-only, defined-risk vertical credit spread economics. No candidate or execution authority. */
export interface SellerVerticalQuote {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  expiry: string;
  side: "CE" | "PE";
  shortStrike: number;
  longStrike: number;
  shortBid: number;
  longAsk: number;
  lotSize: number;
  lots: number;
  shortObservedAtMs: number;
  longObservedAtMs: number;
  asOfMs: number;
  maxQuoteAgeMs: number;
  estimatedRoundTripCosts: number;
  availableCapital: number | null;
  brokerMarginRequired: number | null;
}
export type SellerVerticalResult =
  | { ready: false; blockers: string[]; researchOnly: true; affectsExecution: false; createsOrders: false }
  | { ready: true; netCreditPerUnit: number; grossCredit: number; estimatedNetCredit: number; spreadWidth: number; maxGrossLoss: number; estimatedMaxLoss: number; breakeven: number; requiredMargin: number; researchOnly: true; affectsExecution: false; createsOrders: false };
const SAFE = {researchOnly: true as const, affectsExecution: false as const, createsOrders: false as const};
export function evaluateSellerVertical(input: SellerVerticalQuote): SellerVerticalResult {
  const blockers: string[] = [];
  if (!input || !["NIFTY","SENSEX","BANKNIFTY"].includes(input.symbol) || !/[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.expiry) || !["CE","PE"].includes(input.side)) blockers.push("INVALID_CONTRACT_IDENTITY");
  const nums = [input?.shortStrike,input?.longStrike,input?.shortBid,input?.longAsk,input?.lotSize,input?.lots,input?.shortObservedAtMs,input?.longObservedAtMs,input?.asOfMs,input?.maxQuoteAgeMs,input?.estimatedRoundTripCosts];
  if (nums.some(v=>typeof v!=="number"||!Number.isFinite(v))) blockers.push("INVALID_NUMERIC_EVIDENCE");
  if (blockers.length) return {ready:false,blockers,...SAFE};
  if (input.shortStrike<=0||input.longStrike<=0||input.shortStrike===input.longStrike||input.shortBid<=0||input.longAsk<=0||!Number.isInteger(input.lotSize)||input.lotSize<=0||!Number.isInteger(input.lots)||input.lots<=0||input.estimatedRoundTripCosts<0) blockers.push("INVALID_STRATEGY_PARAMETERS");
  if ((input.side==="CE" && input.longStrike<=input.shortStrike)||(input.side==="PE"&&input.longStrike>=input.shortStrike)) blockers.push("INVALID_HEDGE_DIRECTION");
  if (input.maxQuoteAgeMs<=0||[input.shortObservedAtMs,input.longObservedAtMs].some(t=>t<=0||t>input.asOfMs||input.asOfMs-t>input.maxQuoteAgeMs)) blockers.push("STALE_OR_FUTURE_QUOTE");
  if (input.availableCapital===null||!Number.isFinite(input.availableCapital)||input.availableCapital<0||input.brokerMarginRequired===null||!Number.isFinite(input.brokerMarginRequired)||input.brokerMarginRequired<=0) blockers.push("BROKER_MARGIN_EVIDENCE_REQUIRED");
  const width=Math.abs(input.longStrike-input.shortStrike),credit=input.shortBid-input.longAsk,qty=input.lotSize*input.lots;
  if (!(credit>0&&credit<width)) blockers.push("NON_EXECUTABLE_OR_INVALID_CREDIT");
  const grossLoss=(width-credit)*qty,estimatedLoss=grossLoss+input.estimatedRoundTripCosts;
  if (estimatedLoss<=0||!Number.isFinite(estimatedLoss)) blockers.push("INVALID_MAX_LOSS");
  if (input.brokerMarginRequired!==null&&input.availableCapital!==null&&(input.brokerMarginRequired>input.availableCapital||estimatedLoss>input.availableCapital)) blockers.push("CAPITAL_INSUFFICIENT");
  if (blockers.length) return {ready:false,blockers:[...new Set(blockers)],...SAFE};
  return {ready:true,netCreditPerUnit:credit,grossCredit:credit*qty,estimatedNetCredit:credit*qty-input.estimatedRoundTripCosts,spreadWidth:width,maxGrossLoss:grossLoss,estimatedMaxLoss:estimatedLoss,breakeven:input.side==="CE"?input.shortStrike+credit:input.shortStrike-credit,requiredMargin:input.brokerMarginRequired!,...SAFE};
}
