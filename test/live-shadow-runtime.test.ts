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

const contract = {
  index: "NIFTY" as const,
  optionType: "CE" as const,
  strike: 25000,
  expiry: "2026-09-03",
  instrumentToken: "NIFTY-25000-CE-20260903",
};

const entry = {
  gate,
  tradeId: "LIVE-RUNTIME-1",
  ts: "2026-09-01T09:30:00+05:30",
  index: "NIFTY" as const,
  entryPremium: 120,
  entryQty: 130,
  initialTrailingSl: 112,
  contract,
};

test("runtime starts valid contract-bound shadow trade but never enables broker orders", async () => {
  const runtime = new LiveShadowRuntime();
  const r = await runtime.begin(entry);
  assert.ok(r.evidence);
  assert.equal(r.active, true);
  assert.equal(r.exactContractBound, true);
  assert.deepEqual(r.identity, contract);
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

test("runtime rejects contract/index mismatch at begin", async () => {
  const runtime = new LiveShadowRuntime();
  const r = await runtime.begin({ ...entry, tradeId: "LIVE-MISMATCH", contract: { ...contract, index: "SENSEX" as const } });
  assert.equal(r.evidence, null);
  assert.equal(r.active, false);
  assert.equal(r.reason, "RUNTIME_INVALID_OR_MISMATCHED_CONTRACT");
});

test("runtime applies valid exact-contract market tick and TSL update", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  const r = await runtime.applyMarketTick(entry.tradeId, {
    ts: "2026-09-01T09:35:00+05:30",
    index: "NIFTY",
    optionType: "CE",
    strike: 25000,
    expiry: "2026-09-03",
    premium: 128,
    instrumentToken: "NIFTY-25000-CE-20260903",
  }, {
    event: "TSL_UPDATE",
    trailingSl: 118,
  });
  assert.ok(r.evidence);
  assert.equal(r.active, true);
  assert.equal(r.evidence?.lastTrailingSl, 118);
  assert.equal(r.brokerOrderAllowed, false);
});

test("runtime rejects wrong-contract market tick without mutating trade", async () => {
  const runtime = new LiveShadowRuntime();
  await runtime.begin(entry);
  const bad = await runtime.applyMarketTick(entry.tradeId, {
    ts: "2026-09-01T09:35:00+05:30",
    index: "NIFTY",
    optionType: "PE",
    strike: 25000,
    expiry: "2026-09-03",
    premium: 128,
    instrumentToken: "NIFTY-25000-PE-20260903",
  }, {
    event: "TSL_UPDATE",
    trailingSl: 118,
  });
  assert.equal(bad.reason, "RUNTIME_LIVE_TICK_CONTRACT_MISMATCH");
  assert.equal(runtime.getActive(entry.tradeId)?.lastTrailingSl, 112);
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
  assert.equal(runtime.getContract(entry.tradeId), null);
});

test("blocked forward gate never enters runtime", async () => {
  const runtime = new LiveShadowRuntime();
  const r = await runtime.begin({ ...entry, tradeId: "LIVE-BLOCKED", gate: { ...gate, liveDataFresh: false } });
  assert.equal(r.evidence, null);
  assert.equal(r.active, false);
  assert.equal(r.brokerOrderAllowed, false);
});
