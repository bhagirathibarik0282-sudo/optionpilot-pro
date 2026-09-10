import { evaluateImmediateExpansionChain, type ImmediateExpansionChainInput, type ImmediateExpansionChainResult } from "./immediate-expansion-chain.js";
import type { RecorderIngestPayload } from "./option-recorder-runtime.js";

export const SWEET_SPOT_MARKER = "OPTIONPILOT SWEET SPOT ALERT" as const;

export type ImmediateTelegramRuntimeResult = {
  version: "IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V2";
  semantics: "RESEARCH_SHADOW_ONLY";
  eligible: boolean;
  reason: "NO_IMMEDIATE_CONTEXT" | "WAIT_VERDICT" | "DIRECTIONAL_MESSAGE_READY";
  chain: ImmediateExpansionChainResult | null;
  text: string | null;
  fingerprint: string | null;
  haikuFacts: string[];
  affectsVerdict: false;
  affectsExecution: false;
};

function sideFromVerdict(verdict: ImmediateExpansionChainResult["verdict"]): "CE" | "PE" | "NONE" {
  if (verdict === "CE_FAVOURED") return "CE";
  if (verdict === "PE_FAVOURED") return "PE";
  return "NONE";
}

function businessText(payload: RecorderIngestPayload, chain: ImmediateExpansionChainResult, side: "CE" | "PE"): string {
  const action = side === "CE" ? "BUY CE WATCH" : "BUY PE WATCH";
  const facts = chain.immediateEvents
    .filter((e) => e.alignment === "FAVOURS_TREND")
    .map((e) => `• ${e.family}: ${e.fact.trim()}`)
    .slice(0, 5);
  const spot = Number.isFinite(payload.market.spot) ? Number(payload.market.spot).toFixed(2) : "—";
  const fut = Number.isFinite(payload.market.future) ? Number(payload.market.future).toFixed(2) : "—";
  return [
    `⚡ ${SWEET_SPOT_MARKER}`,
    `${payload.market.symbol} • ${action}`,
    `Spot ${spot} | Fut ${fut}`,
    "",
    "WHY NOW",
    ...(facts.length ? facts : [`• ${chain.whyNow}`]),
    "",
    `PRE-MOVEMENT BIAS: ${side === "CE" ? "BULLISH" : "BEARISH"}`,
    `VERIFIED CLUSTER: ${chain.immediateEvents.length} fresh abnormal events`,
    `WATCH: ${chain.whatToWatch}`,
    `INVALIDATION: ${chain.invalidation}`,
    "",
    `🎯 BUSINESS ACTION: ${action}`,
    "Special alert can fire immediately when the verified cluster forms; no 3M/6M/15M boundary required.",
    "Final trade authority remains with the canonical selector. No execution is created by this alert.",
  ].join("\n");
}

/**
 * Immediate Sweet Spot presentation on top of the existing verified expansion chain.
 * Upstream logic still owns abnormal-change detection, freshness, trend lock and cluster readiness.
 * This layer never invents thresholds and never changes selector or execution authority.
 */
export function buildImmediateExpansionTelegramRuntime(payload: RecorderIngestPayload): ImmediateTelegramRuntimeResult {
  if (!payload.immediateExpansion) {
    return { version:"IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V2", semantics:"RESEARCH_SHADOW_ONLY", eligible:false, reason:"NO_IMMEDIATE_CONTEXT", chain:null, text:null, fingerprint:null, haikuFacts:[], affectsVerdict:false, affectsExecution:false };
  }

  const input: ImmediateExpansionChainInput = {
    symbol: payload.market.symbol,
    lockedTrendSide: payload.immediateExpansion.lockedTrendSide,
    trendValid: payload.immediateExpansion.trendValid,
    clusterReady: payload.immediateExpansion.clusterReady,
    events: payload.immediateExpansion.events,
  };
  const chain = evaluateImmediateExpansionChain(input);
  const side = sideFromVerdict(chain.verdict);

  if (side === "NONE") {
    return { version:"IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V2", semantics:"RESEARCH_SHADOW_ONLY", eligible:false, reason:"WAIT_VERDICT", chain, text:null, fingerprint:null, haikuFacts:chain.haikuFacts, affectsVerdict:false, affectsExecution:false };
  }

  const text = businessText(payload, chain, side);
  const fingerprint = [payload.market.symbol, chain.verdict, ...chain.immediateEvents.map((event) => event.id), text].join("|");

  return {
    version:"IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V2",
    semantics:"RESEARCH_SHADOW_ONLY",
    eligible:true,
    reason:"DIRECTIONAL_MESSAGE_READY",
    chain,
    text,
    fingerprint,
    haikuFacts:chain.haikuFacts,
    affectsVerdict:false,
    affectsExecution:false,
  };
}
