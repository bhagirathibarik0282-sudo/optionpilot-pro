import type { H1ShadowMeaningfulChangePreview } from "./h1-shadow-meaningful-change-preview.js";

export interface H1ShadowTelegramMessageContract {
  version: "H1_SHADOW_TELEGRAM_MESSAGE_CONTRACT_V1";
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
  semantics: "SHADOW_PREVIEW_TO_TEXT_ONLY_NO_TRANSPORT";
}

const VERSION = "H1_SHADOW_TELEGRAM_MESSAGE_CONTRACT_V1" as const;
const SEMANTICS = "SHADOW_PREVIEW_TO_TEXT_ONLY_NO_TRANSPORT" as const;

function blocked(blockers: string[]): H1ShadowTelegramMessageContract {
  return {
    version: VERSION,
    ready: false,
    renderable: false,
    text: null,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

export function renderH1ShadowTelegramMessage(
  preview: H1ShadowMeaningfulChangePreview | null,
): H1ShadowTelegramMessageContract {
  const blockers: string[] = [];
  if (!preview) blockers.push("MISSING_MEANINGFUL_CHANGE_PREVIEW");
  if (preview) {
    if (!preview.ready || preview.blockers.length > 0) blockers.push("PREVIEW_NOT_READY");
    if (!preview.meaningfulChange) blockers.push("NO_MEANINGFUL_CHANGE");
    if (!preview.observedAt || !Number.isFinite(Date.parse(preview.observedAt))) blockers.push("INVALID_PREVIEW_TIMESTAMP");
    if (
      preview.productionImpact !== "NONE" ||
      preview.telegramSendAllowed ||
      preview.affectsTelegram ||
      preview.affectsVerdict ||
      preview.affectsExecution ||
      preview.grantsPromotionAuthority ||
      !preview.failClosed
    ) {
      blockers.push("PREVIEW_AUTHORITY_CONTRACT_VIOLATION");
    }
  }
  if (blockers.length > 0 || !preview) return blocked(blockers);

  const lines = [
    `H1 SHADOW ${preview.kind ?? "CHANGE"}`,
    `Observed: ${preview.observedAt}`,
    `Added: ${preview.added.length ? preview.added.join(", ") : "none"}`,
    `Removed: ${preview.removed.length ? preview.removed.join(", ") : "none"}`,
    `Changed: ${preview.changed.length ? preview.changed.join(", ") : "none"}`,
  ];

  for (const decision of preview.decisions) {
    lines.push(`${decision.key} → ${decision.decision} [${decision.reasonCodes.join(", ") || "NO_REASON"}]`);
  }

  return {
    ...blocked([]),
    ready: true,
    renderable: true,
    text: lines.join("\n"),
    blockers: [],
  };
}
