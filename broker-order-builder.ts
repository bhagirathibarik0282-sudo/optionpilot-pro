// Pure broker-order intent builder. It NEVER calls a broker API or places an order.
// Long option entries are LIMIT-only and fail closed on stale/failed liquidity evidence
// or excessive quote drift from the validated decision quote.

export type BrokerOrderBuildDecision = "BUILD" | "BLOCK";

export interface BrokerOrderBuilderInput {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  tradingsymbol: string;
  exchange: "NFO" | "BFO";
  quantity: number;
  liquidityDecision: "ALLOW" | "BLOCK";
  validatedAsk: number;
  currentAsk: number;
  quoteFresh: boolean;
  tickSize: number;
  maxEntrySlippagePct: number;
}

export interface BrokerOrderIntent {
  variety: "REGULAR";
  transactionType: "BUY";
  product: "MIS";
  orderType: "LIMIT";
  exchange: "NFO" | "BFO";
  tradingsymbol: string;
  quantity: number;
  price: number;
}

export interface BrokerOrderBuilderResult {
  version: "BROKER_ORDER_BUILDER_V1";
  decision: BrokerOrderBuildDecision;
  intent: BrokerOrderIntent | null;
  observedSlippagePct: number | null;
  reasonCodes: string[];
  failClosed: true;
  placesOrder: false;
}

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function roundUpToTick(price: number, tickSize: number): number {
  const ticks = Math.ceil((price - 1e-12) / tickSize);
  return Number((ticks * tickSize).toFixed(8));
}

export function buildProtectedBrokerOrder(input: BrokerOrderBuilderInput): BrokerOrderBuilderResult {
  const reasons: string[] = [];

  if (!(input?.symbol === "NIFTY" || input?.symbol === "SENSEX" || input?.symbol === "BANKNIFTY")) reasons.push("UNSUPPORTED_SYMBOL");
  if (typeof input?.tradingsymbol !== "string" || input.tradingsymbol.trim().length === 0) reasons.push("INVALID_TRADINGSYMBOL");
  if (!(input?.exchange === "NFO" || input?.exchange === "BFO")) reasons.push("INVALID_EXCHANGE");
  if (input?.symbol === "SENSEX" && input?.exchange !== "BFO") reasons.push("SENSEX_EXCHANGE_MISMATCH");
  if ((input?.symbol === "NIFTY" || input?.symbol === "BANKNIFTY") && input?.exchange !== "NFO") reasons.push("NSE_INDEX_EXCHANGE_MISMATCH");
  if (!Number.isInteger(input?.quantity) || input.quantity <= 0) reasons.push("INVALID_QUANTITY");
  if (input?.liquidityDecision !== "ALLOW") reasons.push("LIQUIDITY_SPREAD_GATE_NOT_PASSED");
  if (input?.quoteFresh !== true) reasons.push("QUOTE_NOT_FRESH");
  if (!finitePositive(input?.validatedAsk) || !finitePositive(input?.currentAsk)) reasons.push("INVALID_ASK_PRICE");
  if (!finitePositive(input?.tickSize)) reasons.push("INVALID_TICK_SIZE");
  if (!Number.isFinite(input?.maxEntrySlippagePct) || input.maxEntrySlippagePct < 0) reasons.push("INVALID_SLIPPAGE_POLICY");

  let observedSlippagePct: number | null = null;
  if (reasons.length === 0) {
    observedSlippagePct = ((input.currentAsk - input.validatedAsk) / input.validatedAsk) * 100;
    // Better prices are allowed; adverse drift beyond policy is blocked.
    if (observedSlippagePct > input.maxEntrySlippagePct) reasons.push("ENTRY_SLIPPAGE_CAP_EXCEEDED");
  }

  if (reasons.length > 0) {
    return {
      version: "BROKER_ORDER_BUILDER_V1",
      decision: "BLOCK",
      intent: null,
      observedSlippagePct,
      reasonCodes: reasons,
      failClosed: true,
      placesOrder: false,
    };
  }

  const price = roundUpToTick(input.currentAsk, input.tickSize);
  return {
    version: "BROKER_ORDER_BUILDER_V1",
    decision: "BUILD",
    intent: {
      variety: "REGULAR",
      transactionType: "BUY",
      product: "MIS",
      orderType: "LIMIT",
      exchange: input.exchange,
      tradingsymbol: input.tradingsymbol.trim(),
      quantity: input.quantity,
      price,
    },
    observedSlippagePct,
    reasonCodes: ["PROTECTED_LIMIT_ORDER_INTENT_BUILT"],
    failClosed: true,
    placesOrder: false,
  };
}
