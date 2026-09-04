import { buildH1ReadOnlyShadowDecisionInputBoundary, type H1ReadOnlyShadowDecisionInputBoundaryResult } from "./h1-readonly-shadow-decision-input-boundary.js";
import type { H1LiveExactReadOnlyWebSocketStatus } from "./h1-live-exact-readonly-websocket-service.js";

export interface H1LiveShadowDecisionInputObserverResult {
  version: "H1_LIVE_SHADOW_DECISION_INPUT_OBSERVER_V1";
  observed: H1ReadOnlyShadowDecisionInputBoundaryResult;
  sourceSocketState: H1LiveExactReadOnlyWebSocketStatus["state"];
  sourceConnected: boolean;
  sourcePacketCount: number;
  sourceRejectedPacketCount: number;
  sourceHealthBlockers: string[];
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
 * Pure observer over the already-running single-socket read-only status.
 * It does not start transport, mutate runtime state, infer CE/PE, select a
 * candidate, publish a verdict, execute an order, or send Telegram.
 */
export function observeH1LiveShadowDecisionInput(
  status: H1LiveExactReadOnlyWebSocketStatus,
): H1LiveShadowDecisionInputObserverResult {
  const sourceHealthBlockers: string[] = [];
  if (!status.started || !status.connected || status.state !== "OPEN") sourceHealthBlockers.push("SOURCE_SOCKET_NOT_OPEN");
  if (status.productionImpact !== "NONE" || status.readOnly !== true || status.forwardsDownstream !== false || status.affectsVerdict !== false || status.affectsExecution !== false || status.affectsTelegram !== false || status.failClosed !== true) {
    sourceHealthBlockers.push("SOURCE_SAFETY_CONTRACT_INVALID");
  }

  const safeRows = sourceHealthBlockers.length === 0
    ? status.readOnlyShadowInputObservations
    : status.readOnlyShadowInputObservations.map((row) => ({
        ...row,
        ready: false,
        direction: null,
        blockers: [...new Set([...row.blockers, ...sourceHealthBlockers])],
      }));
  const observed = buildH1ReadOnlyShadowDecisionInputBoundary(safeRows);
  return {
    version: "H1_LIVE_SHADOW_DECISION_INPUT_OBSERVER_V1",
    observed,
    sourceSocketState: status.state,
    sourceConnected: status.connected,
    sourcePacketCount: status.receivedPacketCount,
    sourceRejectedPacketCount: status.rejectedPacketCount,
    sourceHealthBlockers,
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
