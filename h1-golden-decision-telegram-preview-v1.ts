import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";
import type { H1GoldEvidenceAdapterResult } from "./h1-gold-evidence-adapter-v1.js";
import {
  buildH1GoldenDecisionCard,
  type H1GoldenDecisionStage,
  type H1GoldenForwardStatus,
} from "./h1-golden-decision-card-v1.js";

export const H1_GOLDEN_DECISION_TELEGRAM_PREVIEW_V1 = "H1_GOLDEN_DECISION_TELEGRAM_PREVIEW_V1" as const;

export interface H1GoldenDecisionTelegramPreview {
  version: typeof H1_GOLDEN_DECISION_TELEGRAM_PREVIEW_V1;
  semantics: "GOLD_DECISION_TELEGRAM_PREVIEW_ONLY_NO_SEND_NO_EXECUTABLE_PLAN";
  destination: "SPECIAL_OPTION_SELECTION";
  presentationKey: string;
  identityValid: boolean;
  cardStage: H1GoldenDecisionStage;
  forwardStatus: H1GoldenForwardStatus;
  text: string;
  previewOnly: true;
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

function listOrNone(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10_000) / 10_000;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Telegram presentation preview only.
 *
 * It delegates all state derivation to the mandatory Golden Decision Card and
 * never imports Telegram transport, executable trade formatting or broker code.
 * Therefore presentation cannot manufacture a candidate, upgrade SHADOW_ONLY,
 * invent Entry/SL/Target levels or create send/execution authority.
 */
export function buildH1GoldenDecisionTelegramPreview(
  input: H1GoldEvidenceAdapterResult | null | undefined,
  journal?: BusinessForwardJournalRecord | null,
): H1GoldenDecisionTelegramPreview {
  const card = buildH1GoldenDecisionCard(input, journal);

  const lines = [
    "🟡 GOLD DECISION PREVIEW",
    card.identityValid && card.symbol && card.side
      ? `${card.symbol} • ${card.side}`
      : "INVALID GOLD IDENTITY",
    `Stage: ${card.stage.replaceAll("_", " ")}`,
    `Strict Gold: ${card.strictGoldState.replaceAll("_", " ")}`,
    `Forward: ${card.forwardStatus.replaceAll("_", " ")}`,
    `Core confirmation: ${card.corePassed}/${card.coreTotal}`,
    `Missing core: ${listOrNone(card.missingCoreConfirmations)}`,
    `Missing context: ${listOrNone(card.missingContextFamilies)}`,
    `Strict blockers: ${listOrNone(card.strictGoldBlockers)}`,
    `Forward blockers: ${listOrNone(card.forwardBlockers)}`,
    `Forward windows: ${listOrNone(card.completedForwardWindows)}`,
    `Selected candidate: ${card.selectedCandidateKey ?? "—"}`,
    `Selected return: ${pct(card.selectedTerminalReturnPct)} | MFE ${pct(card.selectedMfePct)} | MAE ${pct(card.selectedMaePct)}`,
    `Status: ${card.statusMessage}`,
    "Outcome classification: NOT DEFINED | Sample sufficiency: NOT DEFINED | Promotion threshold: NOT DEFINED",
    "Research preview only — no Entry / SL / Target plan, no Telegram send authority, no execution authority.",
  ];

  return {
    version: H1_GOLDEN_DECISION_TELEGRAM_PREVIEW_V1,
    semantics: "GOLD_DECISION_TELEGRAM_PREVIEW_ONLY_NO_SEND_NO_EXECUTABLE_PLAN",
    destination: "SPECIAL_OPTION_SELECTION",
    presentationKey: card.presentationKey,
    identityValid: card.identityValid,
    cardStage: card.stage,
    forwardStatus: card.forwardStatus,
    text: lines.join("\n"),
    previewOnly: true,
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
