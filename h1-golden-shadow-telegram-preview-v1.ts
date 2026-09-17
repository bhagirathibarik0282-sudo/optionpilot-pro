import type { H1GoldenShadowCandidateResult } from "./h1-golden-shadow-candidate-v1.js";
import {
  H1_GOLDEN_SHADOW_CARD_V1,
  projectH1GoldenShadowCard,
} from "./h1-golden-shadow-card-v1.js";

export const H1_GOLDEN_SHADOW_TELEGRAM_PREVIEW_V1 = "H1_GOLDEN_SHADOW_TELEGRAM_PREVIEW_V1" as const;

export interface H1GoldenShadowTelegramPreview {
  version: typeof H1_GOLDEN_SHADOW_TELEGRAM_PREVIEW_V1;
  semantics: "RESEARCH_SHADOW_PREVIEW_ONLY_NO_SEND_NO_EXECUTABLE_PLAN";
  destination: "SPECIAL_OPTION_SELECTION";
  presentationKey: string | null;
  candidateState: "GOLDEN_SHADOW_CANDIDATE" | "NOT_PRESENTABLE";
  text: string;
  executablePlanShown: false;
  sendable: false;
  sendsTelegram: false;
  affectsTelegram: false;
  affectsSelector: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  productionImpact: "NONE";
  failClosed: true;
}

function blockedPreview(): H1GoldenShadowTelegramPreview {
  return {
    version: H1_GOLDEN_SHADOW_TELEGRAM_PREVIEW_V1,
    semantics: "RESEARCH_SHADOW_PREVIEW_ONLY_NO_SEND_NO_EXECUTABLE_PLAN",
    destination: "SPECIAL_OPTION_SELECTION",
    presentationKey: null,
    candidateState: "NOT_PRESENTABLE",
    text: "⚫ GOLDEN SHADOW • NOT PRESENTABLE\nNo approved Golden shadow candidate. No trade plan shown.",
    executablePlanShown: false,
    sendable: false,
    sendsTelegram: false,
    affectsTelegram: false,
    affectsSelector: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    productionImpact: "NONE",
    failClosed: true,
  };
}

function listOrNone(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

/**
 * Presentation-only Telegram preview. It consumes the exact Golden candidate,
 * projects it through the read-only Golden card, and never invokes Telegram
 * network transport or the executable trade-card formatter.
 */
export function buildH1GoldenShadowTelegramPreview(
  candidate: H1GoldenShadowCandidateResult | null | undefined,
): H1GoldenShadowTelegramPreview {
  const card = projectH1GoldenShadowCard(candidate);
  if (!card || card.version !== H1_GOLDEN_SHADOW_CARD_V1) return blockedPreview();

  const text = [
    `🟡 <b>${card.headline}</b>`,
    `Candidate side: ${card.side}`,
    `Core confirmation: ${card.corePassed}/${card.coreTotal}`,
    `Passed core: ${listOrNone(card.passedCoreConfirmations)}`,
    `Missing core: ${listOrNone(card.missingCoreConfirmations)}`,
    `Missing context: ${listOrNone(card.missingContextFamilies)}`,
    `Observed: ${card.observedAt}`,
    "Research shadow only — no Entry / SL / Target plan and no Telegram send authority.",
  ].join("\n");

  return {
    version: H1_GOLDEN_SHADOW_TELEGRAM_PREVIEW_V1,
    semantics: "RESEARCH_SHADOW_PREVIEW_ONLY_NO_SEND_NO_EXECUTABLE_PLAN",
    destination: "SPECIAL_OPTION_SELECTION",
    presentationKey: card.presentationKey,
    candidateState: "GOLDEN_SHADOW_CANDIDATE",
    text,
    executablePlanShown: false,
    sendable: false,
    sendsTelegram: false,
    affectsTelegram: false,
    affectsSelector: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    productionImpact: "NONE",
    failClosed: true,
  };
}
