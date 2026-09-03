import assert from "node:assert/strict";
import test from "node:test";
import { resolveH1ExactMultiExpiryPeers } from "../h1-exact-multi-expiry-peer-resolver.js";
import type { KiteImmediateTokenEntry } from "../kite-immediate-token-registry.js";

const registry: KiteImmediateTokenEntry[] = [
  { instrumentToken: 101, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W1-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
  { instrumentToken: 102, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24000-CE", expiry: "2026-09-15", strike: 24000, optionSide: "CE" },
  { instrumentToken: 103, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W3-24000-CE", expiry: "2026-09-22", strike: 24000, optionSide: "CE" },
  { instrumentToken: 104, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24000-PE", expiry: "2026-09-15", strike: 24000, optionSide: "PE" },
  { instrumentToken: 105, symbol: "SENSEX", role: "OPTION", instrumentLabel: "SENSEX-W2-80000-CE", expiry: "2026-09-10", strike: 80000, optionSide: "CE" },
];

const now = "2026-09-04T04:00:00.000Z";
const policy = { maxObservationAgeMs: 5_000, requiredPeerCount: 2 };

test("returns verified distinct-expiry exact peers only", () => {
  const out = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
    { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T03:59:58.000Z", directionalState: "SUPPORTS" },
  ], now, policy);

  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.peers.length, 2);
  assert.equal(out.peers[0].expiryDate, "2026-09-15");
  assert.equal(out.peers[1].expiryDate, "2026-09-22");
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.telegramSendAllowed, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.failClosed, true);
});

test("fails closed when exact peers are insufficient", () => {
  const out = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "SUPPORTS" },
  ], now, policy);
  assert.equal(out.ready, false);
  assert.deepEqual(out.peers, []);
  assert.ok(out.blockers.includes("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS"));
});

test("fails closed on stale or future peer evidence", () => {
  const stale = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T03:59:50.000Z", directionalState: "SUPPORTS" },
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
  ], now, policy);
  assert.equal(stale.ready, false);
  assert.ok(stale.blockers.includes("STALE_PEER_EVIDENCE"));

  const future = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T04:00:01.000Z", directionalState: "SUPPORTS" },
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
  ], now, policy);
  assert.equal(future.ready, false);
  assert.ok(future.blockers.includes("FUTURE_PEER_EVIDENCE"));
});

test("rejects contradictory identity instead of silently filtering", () => {
  const oppositeSide = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 104, dte: 11, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "CONFLICTS" },
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
  ], now, policy);
  assert.equal(oppositeSide.ready, false);
  assert.ok(oppositeSide.blockers.includes("PEER_IDENTITY_MISMATCH"));

  const wrongSymbol = resolveH1ExactMultiExpiryPeers(101, registry, [
    { instrumentToken: 105, dte: 6, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "SUPPORTS" },
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
  ], now, policy);
  assert.equal(wrongSymbol.ready, false);
  assert.ok(wrongSymbol.blockers.includes("PEER_IDENTITY_MISMATCH"));
});

test("rejects ambiguous duplicate observations from one expiry", () => {
  const duplicateRegistry: KiteImmediateTokenEntry[] = [
    ...registry,
    { instrumentToken: 106, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24100-CE", expiry: "2026-09-15", strike: 24100, optionSide: "CE" },
  ];
  const out = resolveH1ExactMultiExpiryPeers(101, duplicateRegistry, [
    { instrumentToken: 102, dte: 11, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "SUPPORTS" },
    { instrumentToken: 106, dte: 11, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "SUPPORTS" },
    { instrumentToken: 103, dte: 18, observedAt: "2026-09-04T03:59:59.000Z", directionalState: "NEUTRAL" },
  ], now, policy);
  assert.equal(out.ready, false);
  assert.deepEqual(out.peers, []);
  assert.ok(out.blockers.includes("AMBIGUOUS_DUPLICATE_PEER_EXPIRY"));
});

test("fails closed when target identity or registry is unverified", () => {
  const missingTarget = resolveH1ExactMultiExpiryPeers(999, registry, [], now, policy);
  assert.equal(missingTarget.ready, false);
  assert.ok(missingTarget.blockers.includes("TARGET_OPTION_IDENTITY_UNVERIFIED"));

  const missingRegistry = resolveH1ExactMultiExpiryPeers(101, [], [], now, policy);
  assert.equal(missingRegistry.ready, false);
  assert.ok(missingRegistry.blockers.includes("MISSING_CANONICAL_REGISTRY"));
});
