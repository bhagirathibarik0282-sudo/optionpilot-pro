import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";
import { advanceTradeLifecycle, type TradeLifecycleEvent, type TradeLifecycleState } from "./trade-lifecycle-engine.js";

export const KITE_EXECUTION_SHADOW_V1 = "KITE_EXECUTION_SHADOW_V1" as const;
export type ShadowSymbol = "NIFTY" | "SENSEX";

export interface KiteExecutionShadowInput {
  consumer: CanonicalBusinessConsumerResult | null;
  currentState: TradeLifecycleState;
  event: TradeLifecycleEvent;
  dataFresh: boolean;
  contractValid: boolean;
  activeSymbol: ShadowSymbol | null;
  lots: number;
  entryConditionConfirmed?: boolean;
  entryActivatedConfirmed?: boolean;
  thesisHoldingConfirmed?: boolean;
  protectConditionConfirmed?: boolean;
  partialBookConditionConfirmed?: boolean;
  trailConditionConfirmed?: boolean;
  exitConditionConfirmed?: boolean;
}

export interface KiteExecutionShadowResult {
  version: typeof KITE_EXECUTION_SHADOW_V1;
  ready: boolean;
  decision: "SHADOW_READY" | "BLOCK";
  candidateKey: string | null;
  symbol: ShadowSymbol | null;
  lots: number | null;
  lifecycle: ReturnType<typeof advanceTradeLifecycle> | null;
  blockers: string[];
  broker: "KITE";
  mode: "SHADOW_ONLY";
  sendsBrokerRequest: false;
  createsOrders: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

export function evaluateKiteExecutionShadow(input: KiteExecutionShadowInput): KiteExecutionShadowResult {
  const c = input?.consumer?.buyerCandidate ?? null;
  const blockers: string[] = [];
  if (!c || input.consumer?.candidateKey !== c.candidateKey || input.consumer?.sameCanonicalCandidateForDashboardAndTelegram !== true) {
    blockers.push("CANONICAL_BUSINESS_CANDIDATE_REQUIRED");
  }
  if (c && c.symbol !== "NIFTY" && c.symbol !== "SENSEX") blockers.push("SHADOW_SYMBOL_NOT_SUPPORTED");
  if (input?.lots !== 2) blockers.push("SCALP_TWO_LOTS_REQUIRED");
  if (!input?.dataFresh) blockers.push("LIVE_DATA_NOT_FRESH");
  if (!input?.contractValid) blockers.push("CONTRACT_NOT_VALID");
  if (c && input?.activeSymbol && input.activeSymbol !== c.symbol) blockers.push("NIFTY_SENSEX_EXCLUSIVITY_BLOCK");

  if (blockers.length) {
    return {
      version:KITE_EXECUTION_SHADOW_V1,ready:false,decision:"BLOCK",candidateKey:c?.candidateKey ?? null,
      symbol:c && (c.symbol === "NIFTY" || c.symbol === "SENSEX") ? c.symbol : null,lots:Number.isInteger(input?.lots) ? input.lots : null,
      lifecycle:null,blockers:[...new Set(blockers)],broker:"KITE",mode:"SHADOW_ONLY",sendsBrokerRequest:false,
      createsOrders:false,affectsExecution:false,affectsTelegram:false,failClosed:true,
    };
  }

  const lifecycle = advanceTradeLifecycle({
    currentState:input.currentState,event:input.event,dataFresh:true,contractValid:true,sameCandidate:true,sameStyle:true,
    exitConditionConfirmed:input.exitConditionConfirmed === true,
    partialBookConditionConfirmed:input.partialBookConditionConfirmed === true,
    trailConditionConfirmed:input.trailConditionConfirmed === true,
    protectConditionConfirmed:input.protectConditionConfirmed === true,
    entryConditionConfirmed:input.entryConditionConfirmed === true,
    entryActivatedConfirmed:input.entryActivatedConfirmed === true,
    thesisHoldingConfirmed:input.thesisHoldingConfirmed === true,
  });
  return {
    version:KITE_EXECUTION_SHADOW_V1,ready:true,decision:"SHADOW_READY",candidateKey:c!.candidateKey,symbol:c!.symbol as ShadowSymbol,
    lots:2,lifecycle,blockers:[],broker:"KITE",mode:"SHADOW_ONLY",sendsBrokerRequest:false,createsOrders:false,
    affectsExecution:false,affectsTelegram:false,failClosed:true,
  };
}
