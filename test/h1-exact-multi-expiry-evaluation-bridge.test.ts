import assert from "node:assert/strict";
import test from "node:test";
import { evaluateH1ExactMultiExpiryBridge } from "../h1-exact-multi-expiry-evaluation-bridge.js";
import type { KiteImmediateTokenEntry } from "../kite-immediate-token-registry.js";

const registry: KiteImmediateTokenEntry[] = [
  { instrumentToken: 101, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W1-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
  { instrumentToken: 102, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24000-CE", expiry: "2026-09-15", strike: 24000, optionSide: "CE" },
  { instrumentToken: 103, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W3-24000-CE", expiry: "2026-09-22", strike: 24000, optionSide: "CE" },
];

const now = "2026-09-04T04:00:00.000Z";
const current = {
  source: "LIVE_RUNTIME_EXACT" as const,
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 24000,
  expiryDate: "2026-09-08",
  dte: 4,
  observedAt: "2026-09-04T03:59:59.000Z",
  premiumLtp: 120,
  theta: -3,
  iv: 14,
};
const observations = [
  { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "SUPPORTS" as const },
  { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" as const },
];
const resolverPolicy = { maxObservationAgeMs: 5_000, requiredPeerCount: 2 };
const evaluatorPolicy = {
  maxObservationAgeMs: 5_000,
  maxAbsThetaPctOfPremium: 5,
  minIv: 5,
  maxIv: 40,
  requiredPeerCount: 2,
  maxConflictingPeerCount: 0,
};

test("passes only when exact identity, peer resolution, theta/IV and multi-expiry gates all pass", () => {
  const out = evaluateH1ExactMultiExpiryBridge(101, current, registry, observations, now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.peerResolution.ready, true);
  assert.equal(out.evaluation?.reasonCodes[0], "THETA_IV_AND_MULTI_EXPIRY_GATES_PASSED");
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.telegramSendAllowed, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.failClosed, true);
});

test("fails closed without evaluating when exact peers are unresolved", () => {
  const out = evaluateH1ExactMultiExpiryBridge(101, current, registry, observations.slice(0, 1), now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, false);
  assert.equal(out.evaluation, null);
  assert.ok(out.blockers.includes("EXACT_PEER_RESOLUTION_NOT_READY"));
  assert.ok(out.blockers.includes("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS"));
});

test("fails closed on current-to-registry identity contradiction", () => {
  const mismatched = { ...current, strike: 24100 };
  const out = evaluateH1ExactMultiExpiryBridge(101, mismatched, registry, observations, now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, false);
  assert.equal(out.evaluation, null);
  assert.deepEqual(out.blockers, ["CURRENT_TARGET_IDENTITY_MISMATCH"]);
});

test("fails closed on stale current evidence", () => {
  const stale = { ...current, observedAt: "2026-09-04T03:59:50.000Z" };
  const out = evaluateH1ExactMultiExpiryBridge(101, stale, registry, observations, now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("STALE_CURRENT_EVIDENCE"));
});

test("fails closed on theta/IV burden failure", () => {
  const burdened = { ...current, theta: -12 };
  const out = evaluateH1ExactMultiExpiryBridge(101, burdened, registry, observations, now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
});

test("fails closed when a verified peer conflicts", () => {
  const conflicting = [
    { ...observations[0], directionalState: "CONFLICTS" as const },
    observations[1],
  ];
  const out = evaluateH1ExactMultiExpiryBridge(101, current, registry, conflicting, now, resolverPolicy, evaluatorPolicy);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("MULTI_EXPIRY_CONFLICT_PRESENT"));
});
