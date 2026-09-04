import test from "node:test";
import assert from "node:assert/strict";
import { assessH1ShadowDirection } from "../h1-shadow-direction-assessment.js";
import type { H1LiveShadowDecisionInputObserverResult } from "../h1-live-shadow-decision-input-observer.js";

function observer(): H1LiveShadowDecisionInputObserverResult {
  return {
    version: "H1_LIVE_SHADOW_DECISION_INPUT_OBSERVER_V1",
    observed: {
      version: "H1_READONLY_SHADOW_DECISION_INPUT_BOUNDARY_V1",
      readySymbolCount: 1,
      rows: [
        { symbol: "NIFTY", ready: true, direction: "DOWN", evidenceTokenCount: 5, blockers: [] },
        { symbol: "SENSEX", ready: false, direction: null, evidenceTokenCount: 5, blockers: ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"] },
        { symbol: "BANKNIFTY", ready: false, direction: null, evidenceTokenCount: 3, blockers: ["NEAREST_PEER_NOT_READY"] },
      ],
      semantics: "VERIFIED_DIRECTION_CONTEXT_ONLY_NO_SELECTOR_DECISION",
      productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
      affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
      grantsPromotionAuthority: false, failClosed: true,
    },
    sourceSocketState: "OPEN", sourceConnected: true, sourcePacketCount: 5000, sourceRejectedPacketCount: 0,
    productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
    grantsPromotionAuthority: false, failClosed: true,
  };
}

test("labels only verified ready shadow direction as observation state", () => {
  const result = assessH1ShadowDirection(observer());
  assert.equal(result.readySymbolCount, 1);
  assert.deepEqual(result.rows[0], { symbol: "NIFTY", state: "OBSERVE_DOWN", direction: "DOWN", blockers: [] });
  assert.equal(result.rows[1].state, "BLOCKED");
  assert.equal(result.rows[2].state, "BLOCKED");
  assert.equal(result.semantics, "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT");
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("fails closed when observer source is not healthy", () => {
  const source = observer();
  source.sourceSocketState = "CLOSED";
  source.sourceConnected = false;
  const result = assessH1ShadowDirection(source);
  assert.equal(result.readySymbolCount, 0);
  assert.ok(result.rows.every((row) => row.state === "BLOCKED" && row.direction === null));
  assert.ok(result.rows[0].blockers.includes("SHADOW_OBSERVER_SOURCE_UNHEALTHY"));
});

test("fails closed when source has rejected packets", () => {
  const source = observer();
  source.sourceRejectedPacketCount = 2;
  const result = assessH1ShadowDirection(source);
  assert.equal(result.readySymbolCount, 0);
  assert.ok(result.rows.every((row) => row.state === "BLOCKED"));
  assert.ok(result.rows[0].blockers.includes("SOURCE_REJECTED_PACKETS_PRESENT:2"));
});

test("fails closed when nested observed safety contract drifts", () => {
  const source = observer();
  source.observed.forwardsDownstream = true as false;
  const result = assessH1ShadowDirection(source);
  assert.equal(result.readySymbolCount, 0);
  assert.ok(result.rows.every((row) => row.state === "BLOCKED"));
  assert.ok(result.rows[0].blockers.includes("SHADOW_SAFETY_CONTRACT_INVALID"));
});
