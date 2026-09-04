import assert from "node:assert/strict";
import test from "node:test";
import { acceptH1ExactPeerObservation } from "../h1-exact-peer-observation-boundary.js";

const registry = [
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
];

const valid = {
  instrumentToken: 111,
  dte: 4,
  observedAt: "2026-09-04T03:15:00.000Z",
  directionalState: "SUPPORTS" as const,
  provenance: "LIVE_RUNTIME_EXACT" as const,
};

test("accepts only explicit exact peer observation without inference", () => {
  const out = acceptH1ExactPeerObservation(valid, registry as any);
  assert.equal(out.accepted, true);
  assert.deepEqual(out.observation, {
    instrumentToken: 111,
    dte: 4,
    observedAt: "2026-09-04T03:15:00.000Z",
    directionalState: "SUPPORTS",
  });
  assert.equal(out.infersDirectionalState, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.telegramSendAllowed, false);
});

test("fails closed when token is absent from canonical registry", () => {
  const out = acceptH1ExactPeerObservation({ ...valid, instrumentToken: 999 }, registry as any);
  assert.equal(out.accepted, false);
  assert.equal(out.observation, null);
  assert.ok(out.blockers.includes("PEER_TOKEN_NOT_IN_REGISTRY"));
});

test("fails closed for non-option registry identity", () => {
  const out = acceptH1ExactPeerObservation(valid, [
    { instrumentToken: 111, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
  ] as any);
  assert.equal(out.accepted, false);
  assert.ok(out.blockers.includes("PEER_OPTION_IDENTITY_UNVERIFIED"));
});

test("fails closed for non-exact provenance", () => {
  const out = acceptH1ExactPeerObservation({ ...valid, provenance: "OTHER" as any }, registry as any);
  assert.equal(out.accepted, false);
  assert.ok(out.blockers.includes("NON_EXACT_PEER_PROVENANCE"));
});

test("fails closed for invalid directional state instead of inventing one", () => {
  const out = acceptH1ExactPeerObservation({ ...valid, directionalState: "BULLISH" as any }, registry as any);
  assert.equal(out.accepted, false);
  assert.equal(out.observation, null);
  assert.ok(out.blockers.includes("INVALID_PEER_DIRECTIONAL_STATE"));
});

test("fails closed for duplicate canonical token identity", () => {
  const out = acceptH1ExactPeerObservation(valid, [registry[0], { ...registry[0] }] as any);
  assert.equal(out.accepted, false);
  assert.ok(out.blockers.includes("AMBIGUOUS_PEER_TOKEN"));
});
