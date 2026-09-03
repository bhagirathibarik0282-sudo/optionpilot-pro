import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveThetaIvAndMultiExpiry } from "../h1-live-theta-iv-multi-expiry-evaluator.ts";

const current = {
  source: "LIVE_RUNTIME_EXACT" as const,
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 24000,
  expiryDate: "2026-09-08",
  dte: 5,
  observedAt: "2026-09-03T10:00:00.000Z",
  premiumLtp: 100,
  theta: -2,
  iv: 14,
};
const peers = [
  { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, expiryDate: "2026-09-15", dte: 12, observedAt: "2026-09-03T10:00:00.000Z", directionalState: "SUPPORTS" as const },
  { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, expiryDate: "2026-09-22", dte: 19, observedAt: "2026-09-03T10:00:00.000Z", directionalState: "NEUTRAL" as const },
];
const policy = { maxObservationAgeMs: 60_000, maxAbsThetaPctOfPremium: 3, minIv: 8, maxIv: 30, requiredPeerCount: 2, maxConflictingPeerCount: 0 };

test("passes exact fresh burden and peer evidence", () => {
  const r = evaluateLiveThetaIvAndMultiExpiry(current, peers, "2026-09-03T10:00:30.000Z", policy);
  assert.equal(r.thetaIvBurdenAcceptable, true);
  assert.equal(r.multiExpiryConflictAbsent, true);
});

test("fails closed on stale or future current evidence", () => {
  assert.equal(evaluateLiveThetaIvAndMultiExpiry(current, peers, "2026-09-03T10:02:00.000Z", policy).thetaIvBurdenAcceptable, false);
  assert.match(evaluateLiveThetaIvAndMultiExpiry(current, peers, "2026-09-03T09:59:00.000Z", policy).reasonCodes.join(","), /FUTURE_CURRENT_EVIDENCE/);
});

test("rejects non-exact or insufficient peer evidence", () => {
  const badPeers = [{ ...peers[0], source: "RESEARCH_SHADOW" as any }];
  const r = evaluateLiveThetaIvAndMultiExpiry(current, badPeers as any, "2026-09-03T10:00:30.000Z", policy);
  assert.match(r.reasonCodes.join(","), /INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS/);
});

test("blocks unacceptable theta or IV burden", () => {
  const r = evaluateLiveThetaIvAndMultiExpiry({ ...current, theta: -5 }, peers, "2026-09-03T10:00:30.000Z", policy);
  assert.equal(r.thetaIvBurdenAcceptable, false);
  assert.match(r.reasonCodes.join(","), /THETA_IV_BURDEN_UNACCEPTABLE/);
});

test("blocks explicit multi-expiry conflict", () => {
  const conflictPeers = peers.map((p, i) => i === 0 ? { ...p, directionalState: "CONFLICTS" as const } : p);
  const r = evaluateLiveThetaIvAndMultiExpiry(current, conflictPeers, "2026-09-03T10:00:30.000Z", policy);
  assert.equal(r.multiExpiryConflictAbsent, false);
  assert.match(r.reasonCodes.join(","), /MULTI_EXPIRY_CONFLICT_PRESENT/);
});

test("invalid policy fails closed", () => {
  const r = evaluateLiveThetaIvAndMultiExpiry(current, peers, "2026-09-03T10:00:30.000Z", { ...policy, maxIv: 5 });
  assert.equal(r.thetaIvBurdenAcceptable, false);
  assert.match(r.reasonCodes.join(","), /INVALID_THETA_IV_MULTI_EXPIRY_POLICY/);
});
