import { buildTelegramTradeCard, type TradeCardInput } from "./telegram-trade-card.js";
import type { CandidateStyleSelectionResult } from "./candidate-style-selector.js";

export type CandidateStyleReadyCard = TradeCardInput & { expiryDate: string };

export interface CandidateStyleTelegramPreview {
  version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  text: string;
  executablePlanShown: boolean;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function header(result: CandidateStyleSelectionResult, overrideStatus?: string): string {
  const side = result.side ? ` ${result.side}` : "";
  return `🧭 <b>${result.style}${side}</b> • ${overrideStatus ?? result.status}`;
}

function nonReadyText(result: CandidateStyleSelectionResult): string {
  const lines = [header(result)];
  if (result.status === "BLOCKED") lines.push("🚫 No executable trade plan — style gate blocked.");
  if (result.status === "WATCH") lines.push("🟡 Watch only — confirmations incomplete.");
  if (result.status === "DATA_UNAVAILABLE") lines.push("⚫ Data unavailable — no trade plan can be shown.");
  if (result.reasons.length > 0) lines.push(`Reason: ${result.reasons.join(" | ")}`);
  if (result.devilFlags.length > 0) lines.push(`😈 Devil Check: ${result.devilFlags.join(" | ")}`);
  return lines.join("\n");
}

function blockedPreview(result: CandidateStyleSelectionResult, reason: string): CandidateStyleTelegramPreview {
  return {
    version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    text: `${header(result, "BLOCKED")}\n🚫 ${reason} — no executable trade plan shown.`,
    executablePlanShown: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

/**
 * Research-only adapter between the SCALP/SWING selector and the existing
 * Telegram formatter. It never sends Telegram messages and never upgrades a
 * selector state. Only READY with exact contract identity may render the
 * already-computed TradeCardInput. All mismatches fail closed.
 */
export function buildCandidateStyleTelegramPreview(
  result: CandidateStyleSelectionResult,
  readyCard: CandidateStyleReadyCard | null,
): CandidateStyleTelegramPreview {
  if (result.status !== "READY") {
    return {
      version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      text: nonReadyText(result),
      executablePlanShown: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const contract = result.contract;
  if (!result.candidateKey || !result.side || !contract || !readyCard) {
    return {
      version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      text: `${header(result, "DATA_UNAVAILABLE")}\n⚫ READY selector lacked complete contract/card identity; nothing executable shown.`,
      executablePlanShown: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  if (readyCard.blockStatus?.blocked === true) {
    return blockedPreview(result, "Caller trade card is blocked upstream");
  }

  const expectedDecision = result.side === "CE" ? "BEST_CE" : "BEST_PE";
  const expectedLabel = result.side === "CE" ? "BUY" : "SELL";
  if (readyCard.decision !== expectedDecision || readyCard.label !== expectedLabel) {
    return blockedPreview(result, "Selector/card side or label mismatch");
  }

  if (
    readyCard.symbol !== contract.symbol ||
    readyCard.strike !== contract.strike ||
    readyCard.dte !== contract.dte ||
    readyCard.expiryDate !== contract.expiryDate
  ) {
    return blockedPreview(result, "Selector/card contract identity mismatch");
  }

  return {
    version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    text: `${header(result)}\n━━━━━━━━━━━━━━━━━━━━\n${buildTelegramTradeCard(readyCard)}`,
    executablePlanShown: readyCard.tmPlan?.status === "OK",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
