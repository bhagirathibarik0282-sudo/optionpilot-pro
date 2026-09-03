export type Exchange = "NSE" | "BSE";
export type QuoteQuality = "VERIFIED" | "PROXY" | "DEGRADED" | "STALE" | "UNKNOWN";

export interface ExecutableOptionQuote {
  bid: number | null;
  ask: number | null;
  quality: QuoteQuality;
}

export interface OptionBuyerNetPayoffInput {
  exchange: Exchange;
  quantity: number;
  entry: ExecutableOptionQuote;
  exit: ExecutableOptionQuote;
}

export interface OptionBuyerNetPayoffResult {
  state: "USABLE" | "UNAVAILABLE";
  entryAsk: number | null;
  exitBid: number | null;
  grossPnl: number | null;
  brokerage: number | null;
  stt: number | null;
  transactionCharges: number | null;
  sebiCharges: number | null;
  stampDuty: number | null;
  gst: number | null;
  totalCharges: number | null;
  netPnl: number | null;
  netReturnPctOnPremium: number | null;
  breakevenMovePct: number | null;
  blockers: string[];
  ruleVersion: "OPTION_BUYER_NET_PAYOFF_RESEARCH_V1";
  semantics: "RESEARCH_ONLY";
  executionPricePolicy: "BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID";
  ratePolicy: "ZERODHA_RETAIL_OPTIONS_RATES_VERIFIED_2026_09_03";
  marketImpactPolicy: "UNMODELED_NO_SYNTHETIC_SLIPPAGE";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const BROKERAGE_PER_ORDER = 20;
const STT_SELL = 0.0015;
const NSE_TXN = 0.0003553;
const BSE_TXN = 0.000325;
const SEBI = 10 / 100_000_000;
const STAMP_BUY = 0.00003;
const GST = 0.18;

const finitePositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const verified = (q: QuoteQuality) => q === "VERIFIED";

export function deriveOptionBuyerNetPayoffResearch(input: OptionBuyerNetPayoffInput): OptionBuyerNetPayoffResult {
  const blockers: string[] = [];
  if (!(input.exchange === "NSE" || input.exchange === "BSE")) blockers.push("UNSUPPORTED_EXCHANGE");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) blockers.push("INVALID_QUANTITY");
  if (!verified(input.entry.quality) || !verified(input.exit.quality)) blockers.push("QUOTE_NOT_VERIFIED");
  if (!finitePositive(input.entry.ask)) blockers.push("ENTRY_ASK_UNAVAILABLE");
  if (!finitePositive(input.exit.bid)) blockers.push("EXIT_BID_UNAVAILABLE");
  if (finitePositive(input.entry.bid) && finitePositive(input.entry.ask) && input.entry.bid > input.entry.ask) blockers.push("ENTRY_CROSSED_MARKET");
  if (finitePositive(input.exit.bid) && finitePositive(input.exit.ask) && input.exit.bid > input.exit.ask) blockers.push("EXIT_CROSSED_MARKET");

  const common = {
    ruleVersion: "OPTION_BUYER_NET_PAYOFF_RESEARCH_V1" as const,
    semantics: "RESEARCH_ONLY" as const,
    executionPricePolicy: "BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID" as const,
    ratePolicy: "ZERODHA_RETAIL_OPTIONS_RATES_VERIFIED_2026_09_03" as const,
    marketImpactPolicy: "UNMODELED_NO_SYNTHETIC_SLIPPAGE" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    createsOrders: false as const,
    aiMayOverride: false as const,
  };

  if (blockers.length) return { state:"UNAVAILABLE", entryAsk:null, exitBid:null, grossPnl:null, brokerage:null, stt:null, transactionCharges:null, sebiCharges:null, stampDuty:null, gst:null, totalCharges:null, netPnl:null, netReturnPctOnPremium:null, breakevenMovePct:null, blockers:[...new Set(blockers)], ...common };

  const entryAsk = input.entry.ask as number;
  const exitBid = input.exit.bid as number;
  const qty = input.quantity;
  const buyPremium = entryAsk * qty;
  const sellPremium = exitBid * qty;
  const turnover = buyPremium + sellPremium;
  const grossPnl = sellPremium - buyPremium;
  const brokerage = BROKERAGE_PER_ORDER * 2;
  const stt = sellPremium * STT_SELL;
  const transactionCharges = turnover * (input.exchange === "NSE" ? NSE_TXN : BSE_TXN);
  const sebiCharges = turnover * SEBI;
  const stampDuty = buyPremium * STAMP_BUY;
  const gst = (brokerage + sebiCharges + transactionCharges) * GST;
  const totalCharges = brokerage + stt + transactionCharges + sebiCharges + stampDuty + gst;
  const netPnl = grossPnl - totalCharges;
  const netReturnPctOnPremium = buyPremium === 0 ? null : (netPnl / buyPremium) * 100;
  const breakevenMovePct = buyPremium === 0 ? null : (totalCharges / buyPremium) * 100;

  return { state:"USABLE", entryAsk, exitBid, grossPnl, brokerage, stt, transactionCharges, sebiCharges, stampDuty, gst, totalCharges, netPnl, netReturnPctOnPremium, breakevenMovePct, blockers:[], ...common };
}
