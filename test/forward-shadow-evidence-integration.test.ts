import test from "node:test";
import assert from "node:assert/strict";
import { beginForwardShadowEvidence, applyForwardShadowEvidenceEvent } from "../forward-shadow-evidence-integration.js";

const goodGate = {
  marketOpen: true,
  liveDataFresh: true,
  brokerSessionHealthy: true,
  candidateReady: true,
  quantumAugmentationReady: true,
  hardRiskGatePassed: true,
  liquidityGatePassed: true,
  idempotencyPassed: true,
  killSwitchClear: true,
  runnerLogicRequired: true,
  indexRunnerBufferReady: true,
};

test("starts evidence only when forward shadow gate is ready", () => {
  const s = beginForwardShadowEvidence({ gate: goodGate, tradeId: "T1", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  assert.ok(s);
  assert.equal(s?.brokerOrderAllowed, false);
  assert.equal(s?.remainingQty, 130);
});

test("blocked shadow gate cannot create an entry record", () => {
  const s = beginForwardShadowEvidence({ gate: { ...goodGate, liveDataFresh: false }, tradeId: "T2", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130 });
  assert.equal(s, null);
});

test("runner buffer readiness is mandatory when runner logic is required", () => {
  const s = beginForwardShadowEvidence({ gate: { ...goodGate, indexRunnerBufferReady: false }, tradeId: "T3", ts: "2026-09-01T09:30:00+05:30", index: "SENSEX", entryPremium: 200, entryQty: 40 });
  assert.equal(s, null);
});

test("records partial exit then runner exit with final hypothetical pnl", () => {
  let s = beginForwardShadowEvidence({ gate: goodGate, tradeId: "T4", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  assert.ok(s);
  s = applyForwardShadowEvidenceEvent(s!, { ts: "2026-09-01T09:45:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 65, trailingSl: 125 });
  assert.ok(s);
  s = applyForwardShadowEvidenceEvent(s!, { ts: "2026-09-01T10:05:00+05:30", event: "RUNNER_EXIT", premium: 150, quantity: 65, trailingSl: 138 });
  assert.ok(s);
  assert.equal(s?.closed, true);
  assert.equal(s?.remainingQty, 0);
  assert.equal(s?.hypotheticalPnl, 3250);
});

test("TSL widening attempt is rejected end to end", () => {
  let s = beginForwardShadowEvidence({ gate: goodGate, tradeId: "T5", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  s = applyForwardShadowEvidenceEvent(s!, { ts: "2026-09-01T09:35:00+05:30", event: "TSL_UPDATE", premium: 128, trailingSl: 118 });
  assert.ok(s);
  const bad = applyForwardShadowEvidenceEvent(s!, { ts: "2026-09-01T09:40:00+05:30", event: "TSL_UPDATE", premium: 130, trailingSl: 115 });
  assert.equal(bad, null);
});
