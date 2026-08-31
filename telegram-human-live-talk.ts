export type HumanTalkTradeStyle = "SCALP" | "SWING" | "TRADE";
export type HumanTalkSide = "CE" | "PE" | "NONE";
export type HumanTalkState = "READY" | "WATCH" | "BLOCKED" | "DATA_UNAVAILABLE";

export interface HumanTalkImmediateContext {
  whyNow: string;
  verdict: "CE_FAVOURED" | "PE_FAVOURED" | "WAIT";
  whatToWatch: string;
  invalidation: string;
}

export interface HumanLiveTalkInput {
  style: HumanTalkTradeStyle;
  symbol: string;
  side: HumanTalkSide;
  state: HumanTalkState;
  verdictLocked: true;
  verifiedFacts: string[];
  caution?: string | null;
  immediate?: HumanTalkImmediateContext | null;
}

export interface HumanLiveTalkResult {
  version: "TELEGRAM_HUMAN_LIVE_TALK_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  text: string;
  canChangeVerdict: false;
  canChangeContract: false;
  canInventNumbers: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function cleanFact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sideToImmediateVerdict(side: HumanTalkSide): HumanTalkImmediateContext["verdict"] {
  if (side === "CE") return "CE_FAVOURED";
  if (side === "PE") return "PE_FAVOURED";
  return "WAIT";
}

/**
 * Human-like live-market wording boundary.
 *
 * IMPORTANT: this layer is downstream of the locked deterministic verdict.
 * It may talk naturally about caller-supplied VERIFIED facts, but it cannot
 * choose CE/PE, upgrade WATCH/BLOCKED to READY, create a contract, calculate
 * entry/SL/targets, or invent market numbers. Optional immediate context is
 * also deterministic upstream evidence; this function only renders it.
 */
export function buildHumanLiveTalk(input: HumanLiveTalkInput): HumanLiveTalkResult {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");
  if (input.verdictLocked !== true) throw new Error("verdict must be locked before human talk");

  const facts = input.verifiedFacts.map(cleanFact).filter(Boolean).slice(0, 3);
  const factText = facts.length > 0 ? facts.join(" ") : "No additional verified market context is available yet.";
  const caution = input.caution?.trim() ? ` ${input.caution.trim()}` : "";

  let lead: string;
  if (input.state === "READY" && input.side !== "NONE") {
    lead = `${symbol}: the ${input.style.toLowerCase()} setup is ready on ${input.side}.`;
  } else if (input.state === "WATCH") {
    lead = `${symbol}: I am watching this closely, but the setup is not ready yet.`;
  } else if (input.state === "BLOCKED") {
    lead = `${symbol}: stay out for now — the setup is blocked.`;
  } else {
    lead = `${symbol}: I do not have enough reliable live evidence to call this trade.`;
  }

  let text = `${lead} ${factText}${caution}`.trim();

  if (input.immediate) {
    const expected = input.state === "READY" ? sideToImmediateVerdict(input.side) : "WAIT";
    if (input.immediate.verdict !== expected) {
      throw new Error("immediate verdict must match locked trade state and side");
    }

    text = [
      `⚡ IMMEDIATE CHANGE — ${symbol}`,
      `WHY NOW: ${cleanFact(input.immediate.whyNow)}`,
      `VERDICT: ${input.immediate.verdict.replace("_", " ")}`,
      `WATCH: ${cleanFact(input.immediate.whatToWatch)}`,
      `INVALIDATION: ${cleanFact(input.immediate.invalidation)}`,
      facts.length > 0 ? `EVIDENCE: ${factText}` : "",
      input.caution?.trim() ? `CAUTION: ${cleanFact(input.caution)}` : "",
    ].filter(Boolean).join("\n");
  }

  return {
    version: "TELEGRAM_HUMAN_LIVE_TALK_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    text,
    canChangeVerdict: false,
    canChangeContract: false,
    canInventNumbers: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
