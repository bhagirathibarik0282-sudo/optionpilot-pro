import test from "node:test";
import assert from "node:assert/strict";
import { beginPersistentForwardShadowEvidence, applyPersistentForwardShadowEvidenceEvent } from "../forward-shadow-evidence-persistent-flow.js";

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
  indexSpecificRunnerReady: true,
};

test("blocked gate never creates persistent evidence", async () => {
  const r = await beginPersistentForwardShadowEvidence({ gate: { ...goodGate, liveDataFresh: false }, tradeId: "P1", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130 });
  assert.equal(r.evidence, null);
  assert.equal(r.persisted, false);
  assert.equal(r.brokerOrderAllowed, false);
});

test("valid shadow entry remains broker-order disabled", async () => {
  const r = await beginPersistentForwardShadowEvidence({ gate: goodGate, tradeId: "P2", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  assert.ok(r.evidence);
  assert.equal(r.brokerOrderAllowed, false);
  assert.equal(r.evidence?.brokerOrderAllowed, false);
});

test("valid lifecycle event produces updated evidence while keeping broker disabled", async () => {
  const started = await beginPersistentForwardShadowEvidence({ gate: goodGate, tradeId: "P3", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  assert.ok(started.evidence);
  const next = await applyPersistentForwardShadowEvidenceEvent(started.evidence!, { ts: "2026-09-01T09:35:00+05:30", event: "TSL_UPDATE", premium: 128, trailingSl: 118 });
  assert.ok(next.evidence);
  assert.equal(next.evidence?.lastTrailingSl, 118);
  assert.equal(next.brokerOrderAllowed, false);
});

test("invalid TSL widening event is rejected before persistence", async () => {
  const started = await beginPersistentForwardShadowEvidence({ gate: goodGate, tradeId: "P4", ts: "2026-09-01T09:30:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });
  assert.ok(started.evidence);
  const first = await applyPersistentForwardShadowEvidenceEvent(started.evidence!, { ts: "2026-09-01T09:35:00+05:30", event: "TSL_UPDATE", premium: 128, trailingSl: 118 });
  assert.ok(first.evidence);
  const bad = await applyPersistentForwardShadowEvidenceEvent(first.evidence!, { ts: "2026-09-01T09:40:00+05:30", event: "TSL_UPDATE", premium: 130, trailingSl: 115 });
  assert.equal(bad.evidence, null);
  assert.equal(bad.persisted, false);
});
