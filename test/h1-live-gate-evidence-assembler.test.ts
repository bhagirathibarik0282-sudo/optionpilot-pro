import test from "node:test";
import assert from "node:assert/strict";
import { assembleLiveExecutionCandidateInput, type LiveGateEvidencePacket, type LiveGateName } from "../h1-live-gate-evidence-assembler.js";

const now = "2026-09-03T09:30:00.000Z";

function gate(value: boolean, observedAt = "2026-09-03T09:29:30.000Z") {
  return { value, observedAt, source: "live-runtime-test", provenance: "LIVE_RUNTIME_EXACT" as const };
}

function packet(overrides: Partial<LiveGateEvidencePacket> = {}): LiveGateEvidencePacket {
  const gates: Partial<Record<LiveGateName, ReturnType<typeof gate>>> = {
    capitalFit: gate(true),
    liquidityOk: gate(true),
    spreadOk: gate(true),
    premiumResponseConfirmed: gate(true),
    deltaGammaResponseConfirmed: gate(true),
    thetaIvBurdenAcceptable: gate(true),
    multiExpiryConflictAbsent: gate(true),
    currentOrNearExpiryUsable: gate(true),
  };
  return {
    identity: {
      symbol: "NIFTY",
      side: "CE",
      strike: 24000,
      expiryDate: "2026-09-08",
      dte: 4,
      moneyness: "ATM",
      premiumLtp: 125,
      observedAt: "2026-09-03T09:29:40.000Z",
      source: "live-runtime-test",
      provenance: "LIVE_RUNTIME_EXACT",
    },
    gates,
    ...overrides,
  };
}

test("emits exact NIFTY selector input only when all required gates are fresh", () => {
  const result = assembleLiveExecutionCandidateInput(packet(), now);
  assert.equal(result.ready, true);
  assert.equal(result.candidate?.symbol, "NIFTY");
  assert.equal(result.candidate?.currentOrNearExpiryUsable, true);
  assert.equal(result.candidate?.higherDteUsable, false);
  assert.deepEqual(result.blockers, []);
});

test("missing required gate fails closed", () => {
  const p = packet();
  delete p.gates.premiumResponseConfirmed;
  const result = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(result.ready, false);
  assert.equal(result.candidate, null);
  assert.ok(result.blockers.includes("MISSING_GATE_premiumResponseConfirmed"));
});

test("stale required gate fails closed", () => {
  const p = packet();
  p.gates.liquidityOk = gate(true, "2026-09-03T09:20:00.000Z");
  const result = assembleLiveExecutionCandidateInput(p, now, 90_000);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("STALE_OR_INVALID_TIMESTAMP_liquidityOk"));
});

test("future-dated gate fails closed", () => {
  const p = packet();
  p.gates.spreadOk = gate(true, "2026-09-03T09:31:00.000Z");
  const result = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("STALE_OR_INVALID_TIMESTAMP_spreadOk"));
});

test("non-live provenance fails closed", () => {
  const p = packet();
  p.gates.capitalFit = { ...gate(true), provenance: "RESEARCH_SHADOW_ONLY" as never };
  const result = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("INVALID_PROVENANCE_capitalFit"));
});

test("NIFTY DTE 5-7 requires explicit fallback approval", () => {
  const p = packet();
  p.identity.dte = 6;
  const result = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MISSING_GATE_fallbackDteApproved"));

  p.gates.fallbackDteApproved = gate(true);
  const ready = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(ready.ready, true);
  assert.equal(ready.candidate?.fallbackDteApproved, true);
});

test("BANKNIFTY uses higher-DTE gate and does not require near-expiry gate", () => {
  const p = packet();
  p.identity.symbol = "BANKNIFTY";
  p.identity.strike = 57000;
  p.identity.expiryDate = "2026-09-24";
  p.identity.dte = 21;
  delete p.gates.currentOrNearExpiryUsable;
  p.gates.higherDteUsable = gate(true);
  const result = assembleLiveExecutionCandidateInput(p, now);
  assert.equal(result.ready, true);
  assert.equal(result.candidate?.higherDteUsable, true);
  assert.equal(result.candidate?.currentOrNearExpiryUsable, false);
});

test("stale identity fails closed even when gates are fresh", () => {
  const p = packet();
  p.identity.observedAt = "2026-09-03T09:20:00.000Z";
  const result = assembleLiveExecutionCandidateInput(p, now, 90_000);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("STALE_LIVE_CANDIDATE_IDENTITY"));
});
