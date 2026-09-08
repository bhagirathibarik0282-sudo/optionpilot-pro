import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveThetaIvAndMultiExpiry } from "../h1-live-theta-iv-multi-expiry-evaluator.js";

const now = "2026-09-08T09:30:00.000Z";
const policy = {
  maxObservationAgeMs: 60_000,
  maxAbsThetaPctOfPremium: 3,
  minIv: 8,
  maxIv: 30,
  requiredPeerCount: 1,
  maxConflictingPeerCount: 0,
};

const current = {
  source: "LIVE_RUNTIME_EXACT" as const,
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 23650,
  expiryDate: "2026-09-08",
  dte: 0,
  observedAt: "2026-09-08T09:29:50.000Z",
  premiumLtp: 100,
  theta: -2,
  iv: 18,
};

function peer(directionalState: "SUPPORTS" | "CONFLICTS" | "NEUTRAL") {
  return {
    source: "LIVE_RUNTIME_EXACT" as const,
    symbol: "NIFTY" as const,
    side: "CE" as const,
    expiryDate: "2026-09-15",
    dte: 7,
    observedAt: "2026-09-08T09:29:45.000Z",
    directionalState,
  };
}

test("theta failure does not invent a multi-expiry conflict", () => {
  const result = evaluateLiveThetaIvAndMultiExpiry(
    { ...current, theta: -4 },
    [peer("SUPPORTS")],
    now,
    policy,
  );
  assert.equal(result.thetaIvBurdenAcceptable, false);
  assert.equal(result.multiExpiryConflictAbsent, true);
  assert.ok(result.reasonCodes.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
  assert.ok(!result.reasonCodes.includes("MULTI_EXPIRY_CONFLICT_PRESENT"));
});

test("multi-expiry conflict does not invent a theta IV failure", () => {
  const result = evaluateLiveThetaIvAndMultiExpiry(
    current,
    [peer("CONFLICTS")],
    now,
    policy,
  );
  assert.equal(result.thetaIvBurdenAcceptable, true);
  assert.equal(result.multiExpiryConflictAbsent, false);
  assert.ok(!result.reasonCodes.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
  assert.ok(result.reasonCodes.includes("MULTI_EXPIRY_CONFLICT_PRESENT"));
});

test("independent simultaneous failures report both exact reasons", () => {
  const result = evaluateLiveThetaIvAndMultiExpiry(
    { ...current, theta: -4 },
    [peer("CONFLICTS")],
    now,
    policy,
  );
  assert.equal(result.thetaIvBurdenAcceptable, false);
  assert.equal(result.multiExpiryConflictAbsent, false);
  assert.ok(result.reasonCodes.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
  assert.ok(result.reasonCodes.includes("MULTI_EXPIRY_CONFLICT_PRESENT"));
});
