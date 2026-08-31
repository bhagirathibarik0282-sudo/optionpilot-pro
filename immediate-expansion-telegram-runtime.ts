import { evaluateImmediateExpansionChain, type ImmediateExpansionChainInput, type ImmediateExpansionChainResult } from "./immediate-expansion-chain.js";
import { buildHumanLiveTalk } from "./telegram-human-live-talk.js";
import type { RecorderIngestPayload } from "./option-recorder-runtime.js";

export type ImmediateTelegramRuntimeResult = {
  version: "IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V1";
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

/**
 * Composes already-verified immediate events into the deterministic chain and
 * a Telegram-ready human message. This bridge does NOT decide what is abnormal;
 * source/upstream policy must supply fresh abnormal events and cluster readiness.
 * Haiku may consume haikuFacts but cannot alter verdict/message authority.
 */
export function buildImmediateExpansionTelegramRuntime(
  payload: RecorderIngestPayload,
): ImmediateTelegramRuntimeResult {
  if (!payload.immediateExpansion) {
    return {
      version: "IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      eligible: false,
      reason: "NO_IMMEDIATE_CONTEXT",
      chain: null,
      text: null,
      fingerprint: null,
      haikuFacts: [],
      affectsVerdict: false,
      affectsExecution: false,
    };
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
    return {
      version: "IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      eligible: false,
      reason: "WAIT_VERDICT",
      chain,
      text: null,
      fingerprint: null,
      haikuFacts: chain.haikuFacts,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const text = buildHumanLiveTalk({
    style: "SCALP",
    symbol: payload.market.symbol,
    side,
    state: "READY",
    verdictLocked: true,
    verifiedFacts: chain.haikuFacts.slice(0, 3),
    immediate: {
      whyNow: chain.whyNow,
      verdict: chain.verdict,
      whatToWatch: chain.whatToWatch,
      invalidation: chain.invalidation,
    },
  }).text;

  const fingerprint = [
    payload.market.symbol,
    payload.market.snapshotId,
    chain.verdict,
    ...chain.immediateEvents.map((event) => event.id),
    text,
  ].join("|");

  return {
    version: "IMMEDIATE_EXPANSION_TELEGRAM_RUNTIME_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    eligible: true,
    reason: "DIRECTIONAL_MESSAGE_READY",
    chain,
    text,
    fingerprint,
    haikuFacts: chain.haikuFacts,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
