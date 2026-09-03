import assert from "node:assert/strict";
import test from "node:test";
import {
  clearH1LiveSelectorRegistry,
  collectH1LiveSelectorDecisions,
  getH1LiveSelectorRegistrySize,
  publishH1LiveGateEvidence,
} from "../h1-live-selector-registry.js";

function gate(value: boolean, observedAt: string) {
  return { value, observedAt, source: "LIVE_TEST", provenance: "LIVE_RUNTIME_EXACT" as const };
}

function packet(observedAt: string) {
  return {
    identity: {
      symbol: "NIFTY" as const,
      side: "CE" as const,
      strike: 24000,
      expiryDate: "2026-09-08",
      dte: 5,
      moneyness: "ATM" as const,
      premiumLtp: 100,
      observedAt,
      source: "LIVE_TEST",
      provenance: "LIVE_RUNTIME_EXACT" as const,
    },
    gates: {
      capitalFit: gate(true, observedAt),
      liquidityOk: gate(true, observedAt),
      spreadOk: gate(true, observedAt),
      premiumResponseConfirmed: gate(true, observedAt),
      deltaGammaResponseConfirmed: gate(true, observedAt),
      thetaIvBurdenAcceptable: gate(true, observedAt),
      multiExpiryConflictAbsent: gate(true, observedAt),
      currentOrNearExpiryUsable: gate(true, observedAt),
      fallbackDteApproved: gate(true, observedAt),
    },
  };
}

test("empty registry emits zero decisions", () => {
  clearH1LiveSelectorRegistry();
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z");
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("exact live packet is accepted and produces selector decision", () => {
  clearH1LiveSelectorRegistry();
  const ts = "2026-09-03T09:30:00.000Z";
  assert.equal(publishH1LiveGateEvidence(packet(ts)).accepted, true);
  const out = collectH1LiveSelectorDecisions(ts);
  assert.equal(out.eligibleForLiveH1Marking, true);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].decision, "SELECT");
});

test("stale packet is evicted and cannot mark candidate", () => {
  clearH1LiveSelectorRegistry();
  assert.equal(publishH1LiveGateEvidence(packet("2026-09-03T09:20:00.000Z")).accepted, true);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z", 90_000);
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("future-dated packet is evicted", () => {
  clearH1LiveSelectorRegistry();
  assert.equal(publishH1LiveGateEvidence(packet("2026-09-03T09:31:00.000Z")).accepted, true);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z", 90_000);
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("duplicate exact contract uses latest packet", () => {
  clearH1LiveSelectorRegistry();
  const older = packet("2026-09-03T09:29:30.000Z");
  const newer = packet("2026-09-03T09:29:50.000Z");
  newer.gates.spreadOk = gate(false, "2026-09-03T09:29:50.000Z");
  publishH1LiveGateEvidence(older);
  publishH1LiveGateEvidence(newer);
  assert.equal(getH1LiveSelectorRegistrySize(), 1);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z");
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].decision, "BLOCK");
  assert.ok(out.decisions[0].reasonCodes.includes("SPREAD_GATE_FAILED"));
});
