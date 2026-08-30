import test from "node:test";
import assert from "node:assert/strict";
import { LiveShadowRuntime } from "../live-shadow-runtime.js";

const gate = {
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

const entry = {
  gate,
  tradeId: "LIVE-RUNTIME-1",
  ts: "2026-09-01T09:30:00+05:30",
  index: "NIFTY" as const,
  entryPremium: 120,
  entryQty: 130,
  initialTrailingSl: 112,
};

test("runtime starts valid shadow trade but never enables broker orders", async () => {
  const runtime = new LiveShadowRuntime();
  const r = await runtime.begin(entry);
  assert.ok(r.evidence);
  assert.equal(r.active, true);
  assert.equal(r.brokerOrderAllowed, false);
  assert.equal(r.evidence?.brokerOrderAllowed, false);
});

test("runtime prevents duplicate active trade id", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  const duplicate = await runtime.begin(entry);
  assert.equal(duplicate.evidence, null);
  assert.equal(duplicate.active, false);
  assert.equal(duplicate.reason, "RUNTIME_DUPLICATE_OR_INVALID_TRADE_ID");
});

test("runtime applies valid TSL update and keeps active state", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  const r = await runtime.apply(entry.tradeId, {
    ts: "2026-09-01T09:35:00+05:30",
    event: "TSL_UPDATE",
    premium: 128,
    trailingSl: 118,
  });
  assert.ok(r.evidence);
  assert.equal(r.active, true);
  assert.equal(r.evidence?.lastTrailingSl, 118);
  assert.equal(r.brokerOrderAllowed, false);
});

test("runtime rejects TSL widening without corrupting active state", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  await runtime.apply(entry.tradeId, { ts: "2026-09-01T09:35:00+05:30", event: "TSL_UPDATE", premium: 128, trailingSl: 118 });
  const bad = await runtime.apply(entry.tradeId, { ts: "2026-09-01T09:40:00+05:30", event: "TSL_UPDATE", premium: 130, trailingSl: 115 });
  assert.equal(bad.evidence, null);
  assert.equal(bad.active, true);
  assert.equal(runtime.getActive(entry.tradeId)?.lastTrailingSl, 118);
});

test("runtime closes after partial exit and runner exit", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  const partial = await runtime.apply(entry.tradeId, { ts: "2026-09-01T09:45:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 65, trailingSl: 125 });
  assert.ok(partial.evidence);
  assert.equal(partial.evidence?.remainingQty, 65);
  const closed = await runtime.apply(entry.tradeId, { ts: "2026-09-01T10:05:00+05:30", event: "RUNNER_EXIT", premium: 150, quantity: 65, trailingSl: 138 });
  assert.ok(closed.evidence);
  assert.equal(closed.active, false);
  assert.equal(closed.evidence?.closed, true);
  assert.equal(closed.evidence?.hypotheticalPnl, 3250);
  assert.equal(runtime.getActive(entry.tradeId), null);
});

test("blocked forward gate never enters runtime", async () => {
  const runtime = new LiveShadowRuntime();
  const r = await runtime.begin({ ...entry, tradeId: "LIVE-BLOCKED", gate: { ...gate, liveDataFresh: false } });
  assert.equal(r.evidence, null);
  assert.equal(r.active, false);
  assert.equal(r.brokerOrderAllowed, false);
});
