import test from "node:test";
import assert from "node:assert/strict";
import { observeH1LiveShadowDecisionInput } from "../h1-live-shadow-decision-input-observer.js";
import type { H1LiveExactReadOnlyWebSocketStatus } from "../h1-live-exact-readonly-websocket-service.js";

function status(): H1LiveExactReadOnlyWebSocketStatus {
  return {
    version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1",
    started: true, connected: true, state: "OPEN", subscribedTokenCount: 21,
    receivedPacketCount: 4625, rejectedPacketCount: 0, lastPacketTimestamp: "2026-09-04T09:07:01.877Z",
    rawEvidenceReady: false, rawEvidenceExpectedTokenCount: 21, rawEvidenceFreshTokenCount: 17,
    rawEvidenceMissingTokenCount: 1, rawEvidenceStaleTokenCount: 3, rawEvidenceMissing: [],
    rawEvidenceSymbolReadiness: [], nearestPeerReadiness: [],
    readOnlyConsumerReadySymbolCount: 2, readOnlyConsumerObservations: [],
    readOnlyDirectionReadySymbolCount: 1, readOnlyDirectionObservations: [],
    readOnlyShadowInputReadySymbolCount: 1,
    readOnlyShadowInputObservations: [
      { symbol: "NIFTY", ready: true, direction: "DOWN", evidenceTokenCount: 5, blockers: [] },
      { symbol: "SENSEX", ready: false, direction: null, evidenceTokenCount: 5, blockers: ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"] },
      { symbol: "BANKNIFTY", ready: false, direction: null, evidenceTokenCount: 3, blockers: ["NEAREST_PEER_NOT_READY"] },
    ],
    greekEvidenceStatus: "NOT_CONFIGURED", productionImpact: "NONE", readOnly: true,
    forwardsDownstream: false, affectsDirection: false, affectsVerdict: false,
    affectsExecution: false, affectsTelegram: false, failClosed: true,
  };
}

test("observes existing single-socket shadow input without granting authority", () => {
  const result = observeH1LiveShadowDecisionInput(status());
  assert.equal(result.observed.readySymbolCount, 1);
  assert.deepEqual(result.observed.rows[0], { symbol: "NIFTY", ready: true, direction: "DOWN", evidenceTokenCount: 5, blockers: [] });
  assert.equal(result.sourceSocketState, "OPEN");
  assert.equal(result.sourceConnected, true);
  assert.equal(result.sourcePacketCount, 4625);
  assert.equal(result.sourceRejectedPacketCount, 0);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("remains fail-closed when no symbol is shadow-input ready", () => {
  const s = status();
  s.readOnlyShadowInputReadySymbolCount = 0;
  s.readOnlyShadowInputObservations = s.readOnlyShadowInputObservations.map((row) => ({
    ...row,
    ready: false,
    direction: null,
    blockers: row.blockers.length ? row.blockers : ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"],
  }));
  const result = observeH1LiveShadowDecisionInput(s);
  assert.equal(result.observed.readySymbolCount, 0);
  assert.ok(result.observed.rows.every((row) => !row.ready && row.direction === null));
});
