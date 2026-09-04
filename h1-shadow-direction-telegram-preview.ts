import type { H1ShadowDirectionAssessmentResult } from "./h1-shadow-direction-assessment.js";

export interface H1ShadowDirectionTelegramPreview {
  version: "H1_SHADOW_DIRECTION_TELEGRAM_PREVIEW_V1";
  ready: boolean;
  renderable: boolean;
  text: string | null;
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "DIRECTION_ONLY_SHADOW_TEXT_NO_OPTION_SIDE_NO_TRANSPORT";
}

function base(blockers: string[], text: string | null = null, renderable = false): H1ShadowDirectionTelegramPreview {
  return {
    version: "H1_SHADOW_DIRECTION_TELEGRAM_PREVIEW_V1",
    ready: blockers.length === 0,
    renderable,
    text,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "DIRECTION_ONLY_SHADOW_TEXT_NO_OPTION_SIDE_NO_TRANSPORT",
  };
}

function unsafeAssessment(input: H1ShadowDirectionAssessmentResult): boolean {
  return input.productionImpact !== "NONE" || !input.readOnly || input.forwardsDownstream ||
    input.affectsVerdict || input.affectsExecution || input.affectsTelegram ||
    input.grantsPromotionAuthority || !input.failClosed;
}

/**
 * Pure human-readable preview of verified shadow direction observation.
 * Never maps UP/DOWN to CE/PE, BUY/SELL, candidate selection, verdict, order,
 * publishing, or Telegram transport.
 */
export function renderH1ShadowDirectionTelegramPreview(
  input: H1ShadowDirectionAssessmentResult | null,
  observedAtIso: string,
): H1ShadowDirectionTelegramPreview {
  const blockers: string[] = [];
  if (!input) blockers.push("MISSING_SHADOW_DIRECTION_ASSESSMENT");
  if (!Number.isFinite(Date.parse(observedAtIso))) blockers.push("INVALID_PREVIEW_TIME");
  if (input && unsafeAssessment(input)) blockers.push("SHADOW_DIRECTION_SAFETY_CONTRACT_INVALID");
  if (blockers.length > 0 || !input) return base(blockers);

  const lines = [
    "SHADOW MARKET DIRECTION",
    `Observed: ${observedAtIso}`,
    "Trade authority: OFF",
  ];

  for (const row of input.rows) {
    if (row.state === "BLOCKED") {
      lines.push(`${row.symbol}: BLOCKED | ${row.blockers.length > 0 ? row.blockers.join(", ") : "NO_VERIFIED_DIRECTION"}`);
      continue;
    }
    lines.push(`${row.symbol}: ${row.state} | verified direction ${row.direction}`);
  }

  lines.push("CE/PE inference: OFF", "BUY/SELL inference: OFF", "Telegram send: OFF");
  return base([], lines.join("\n"), true);
}
