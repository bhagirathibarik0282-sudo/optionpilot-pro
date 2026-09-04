import test from "node:test";
import assert from "node:assert/strict";
import { classifyH1ExactPeerDirectionalState } from "../h1-exact-peer-directional-state-classifier.js";

const previous = {
  symbol: "NIFTY",
  expiry: "2026-09-10",
  strike: 24000,
  side: "CE" as const,
  observedAt: "2026-09-04T03:45:00.000Z",
  ltp: 100,
  delta: 0.5,
  gamma: 0.01,
  source: "LIVE_RUNTIME_EXACT" as const,
};
const policy = { maxObservationGapMs: 120000, minAbsolutePremiumMovePct: 1 };

test("classifies support only against explicit expected premium direction", () => {
  const current = { ...previous, observedAt: "2026-09-04T03:46:00.000Z", ltp: 103 };
  const out = classifyH1ExactPeerDirectionalState(previous, current, "UP", policy);
  assert.equal(out.ready, true);
  assert.equal(out.directionalState, "SUPPORTS");
  assert.equal(out.infersExpectedDirectionFromOptionSide, false);
  assert.equal(out.productionImpact, "NONE");
});

test("classifies conflict when exact premium move opposes explicit expectation", () => {
  const current = { ...previous, observedAt: "2026-09-04T03:46:00.000Z", ltp: 97 };
  const out = classifyH1ExactPeerDirectionalState(previous, current, "UP", policy);
  assert.equal(out.ready, true);
  assert.equal(out.directionalState, "CONFLICTS");
});

test("classifies sub-threshold move as neutral", () => {
  const current = { ...previous, observedAt: "2026-09-04T03:46:00.000Z", ltp: 100.5 };
  const out = classifyH1ExactPeerDirectionalState(previous, current, "DOWN", policy);
  assert.equal(out.ready, true);
  assert.equal(out.directionalState, "NEUTRAL");
});

test("fails closed when expected premium direction is absent", () => {
  const current = { ...previous, observedAt: "2026-09-04T03:46:00.000Z", ltp: 103 };
  const out = classifyH1ExactPeerDirectionalState(previous, current, undefined as never, policy);
  assert.equal(out.ready, false);
  assert.equal(out.directionalState, null);
  assert.deepEqual(out.blockers, ["MISSING_OR_INVALID_EXPECTED_PREMIUM_DIRECTION"]);
});

test("fails closed on contract mismatch", () => {
  const current = { ...previous, strike: 24100, observedAt: "2026-09-04T03:46:00.000Z", ltp: 103 };
  const out = classifyH1ExactPeerDirectionalState(previous, current, "UP", policy);
  assert.equal(out.ready, false);
  assert.equal(out.directionalState, null);
  assert.deepEqual(out.blockers, ["CONTRACT_IDENTITY_MISMATCH"]);
});
