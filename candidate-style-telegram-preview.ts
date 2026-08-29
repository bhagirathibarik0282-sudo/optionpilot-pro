import { buildTelegramTradeCard, type TradeCardInput } from "./telegram-trade-card.js";
import type { CandidateStyleSelectionResult } from "./candidate-style-selector.js";

export interface CandidateStyleTelegramPreview {
  version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  text: string;
  executablePlanShown: boolean;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function header(result: CandidateStyleSelectionResult): string {
  const side = result.side ? ` ${result.side}` : "";
  return `🧭 <b>${result.style}${side}</b> • ${result.status}`;
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

/**
 * Research-only adapter between the SCALP/SWING selector and the existing
 * Telegram formatter. It never sends Telegram messages and never upgrades a
 * selector state. Only READY may render the already-computed TradeCardInput.
 * WATCH/BLOCKED/DATA_UNAVAILABLE are rendered without entry/SL/targets.
 */
export function buildCandidateStyleTelegramPreview(
  result: CandidateStyleSelectionResult,
  readyCard: TradeCardInput | null,
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

  if (!result.candidateKey || !result.side || !readyCard) {
    return {
      version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      text: `${header({ ...result, status: "DATA_UNAVAILABLE" })}\n⚫ READY selector lacked a complete caller-supplied card; nothing executable shown.`,
      executablePlanShown: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const expectedDecision = result.side === "CE" ? "BEST_CE" : "BEST_PE";
  if (readyCard.decision !== expectedDecision) {
    return {
      version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      text: `${header({ ...result, status: "BLOCKED" })}\n🚫 Selector/card side mismatch — no executable trade plan shown.`,
      executablePlanShown: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  return {
    version: "CANDIDATE_STYLE_TELEGRAM_PREVIEW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    text: `${header(result)}\n━━━━━━━━━━━━━━━━━━━━\n${buildTelegramTradeCard(readyCard)}`,
    executablePlanShown: readyCard.blockStatus?.blocked !== true && readyCard.tmPlan?.status === "OK",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
