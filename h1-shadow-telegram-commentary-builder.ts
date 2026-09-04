import type { H1ShadowDirectionAssessmentResult } from "./h1-shadow-direction-assessment.js";

export interface H1ShadowTelegramCommentaryMessage {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  publishable: false;
  text: string;
  blockers: string[];
}

export interface H1ShadowTelegramCommentaryBuilderResult {
  version: "H1_SHADOW_TELEGRAM_COMMENTARY_BUILDER_V1";
  messages: H1ShadowTelegramCommentaryMessage[];
  semantics: "FORMAT_ONLY_NO_TELEGRAM_SEND_AUTHORITY";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  canSendTelegram: false;
  failClosed: true;
}

/**
 * Pure formatter only. Converts safe shadow assessment rows into human-readable
 * commentary text. It cannot publish or send Telegram messages and has no
 * verdict, execution, promotion, or candidate-selection authority.
 */
export function buildH1ShadowTelegramCommentary(
  assessment: H1ShadowDirectionAssessmentResult,
): H1ShadowTelegramCommentaryBuilderResult {
  const contractHealthy = assessment.productionImpact === "NONE" && assessment.readOnly &&
    !assessment.forwardsDownstream && !assessment.affectsVerdict && !assessment.affectsExecution &&
    !assessment.affectsTelegram && !assessment.grantsPromotionAuthority && assessment.failClosed &&
    assessment.semantics === "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT";

  const messages = assessment.rows.map((row): H1ShadowTelegramCommentaryMessage => {
    const blockers = new Set(row.blockers);
    if (!contractHealthy) blockers.add("SHADOW_ASSESSMENT_SAFETY_CONTRACT_INVALID");
    if (row.state === "BLOCKED" || !row.direction) blockers.add("SHADOW_ASSESSMENT_NOT_READY");

    let text: string;
    if (blockers.size > 0) {
      text = `${row.symbol} | SHADOW BLOCKED | ${[...blockers].join("; ")}`;
    } else {
      text = `${row.symbol} | LIVE SHADOW ${row.direction} | observation only | no trade authority`;
    }

    return {
      symbol: row.symbol,
      publishable: false,
      text,
      blockers: [...blockers],
    };
  });

  return {
    version: "H1_SHADOW_TELEGRAM_COMMENTARY_BUILDER_V1",
    messages,
    semantics: "FORMAT_ONLY_NO_TELEGRAM_SEND_AUTHORITY",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    canSendTelegram: false,
    failClosed: true,
  };
}
