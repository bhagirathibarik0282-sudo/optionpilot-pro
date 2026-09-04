import type { H1LiveShadowDecisionInputObserverResult } from "./h1-live-shadow-decision-input-observer.js";

export type H1ShadowDirectionAssessmentState = "OBSERVE_UP" | "OBSERVE_DOWN" | "BLOCKED";

export interface H1ShadowDirectionAssessmentRow {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  state: H1ShadowDirectionAssessmentState;
  direction: "UP" | "DOWN" | null;
  blockers: string[];
}

export interface H1ShadowDirectionAssessmentResult {
  version: "H1_SHADOW_DIRECTION_ASSESSMENT_V1";
  readySymbolCount: number;
  rows: H1ShadowDirectionAssessmentRow[];
  semantics: "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

/**
 * Pure research-shadow assessment. It only labels an already-verified direction
 * as OBSERVE_UP/OBSERVE_DOWN. It never infers CE/PE, BUY/SELL, SELECT/BLOCK,
 * candidate identity, verdict, promotion, execution, publishing, or Telegram.
 */
export function assessH1ShadowDirection(
  observer: H1LiveShadowDecisionInputObserverResult,
): H1ShadowDirectionAssessmentResult {
  const observerContractHealthy = observer.productionImpact === "NONE" && observer.readOnly &&
    !observer.forwardsDownstream && !observer.affectsVerdict && !observer.affectsExecution &&
    !observer.affectsTelegram && !observer.grantsPromotionAuthority && observer.failClosed;
  const observedContractHealthy = observer.observed.productionImpact === "NONE" && observer.observed.readOnly &&
    !observer.observed.forwardsDownstream && !observer.observed.affectsVerdict && !observer.observed.affectsExecution &&
    !observer.observed.affectsTelegram && !observer.observed.grantsPromotionAuthority && observer.observed.failClosed;
  const sourceHealthy = observer.sourceConnected && observer.sourceSocketState === "OPEN" &&
    observer.sourceRejectedPacketCount === 0 && observerContractHealthy && observedContractHealthy;

  const rows = observer.observed.rows.map((row): H1ShadowDirectionAssessmentRow => {
    const blockers = new Set(row.blockers);
    if (!sourceHealthy) blockers.add("SHADOW_OBSERVER_SOURCE_UNHEALTHY");
    if (observer.sourceRejectedPacketCount !== 0) blockers.add(`SOURCE_REJECTED_PACKETS_PRESENT:${observer.sourceRejectedPacketCount}`);
    if (!observerContractHealthy || !observedContractHealthy) blockers.add("SHADOW_SAFETY_CONTRACT_INVALID");
    if (!row.ready) blockers.add("SHADOW_DECISION_INPUT_NOT_READY");
    if (row.direction !== "UP" && row.direction !== "DOWN") blockers.add("VERIFIED_DIRECTION_UNAVAILABLE");
    const ready = blockers.size === 0;
    return {
      symbol: row.symbol,
      state: ready ? (row.direction === "UP" ? "OBSERVE_UP" : "OBSERVE_DOWN") : "BLOCKED",
      direction: ready ? row.direction : null,
      blockers: [...blockers],
    };
  });

  return {
    version: "H1_SHADOW_DIRECTION_ASSESSMENT_V1",
    readySymbolCount: rows.filter((row) => row.state !== "BLOCKED").length,
    rows,
    semantics: "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
