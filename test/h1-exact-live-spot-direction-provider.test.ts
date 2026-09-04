import assert from "node:assert/strict";
import test from "node:test";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";
import type { H1ExactUnderlyingObservation } from "../h1-kite-exact-price-greek-adapter.js";

function spot(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY", observedAt: string, price: number, receivedAt = observedAt): H1ExactUnderlyingObservation {
  return { source: "LIVE_RUNTIME_EXACT", symbol, observedAt, receivedAt, price };
}

const policy = { maxObservationGapMs: 10_000, minAbsoluteSpotMovePct: 0.05 };

test("derives UP only from forward same-symbol LIVE_RUNTIME_EXACT spot evidence", () => {
  const out = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000),
    spot("NIFTY", "2026-09-04T04:00:05.000Z", 24024),
    policy,
  );
  assert.equal(out.ready, true);
  assert.equal(out.direction, "UP");
  assert.equal(out.source, "VERIFIED_DETERMINISTIC_RUNTIME");
  assert.equal(out.sourceId, "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1");
  assert.equal(out.liveRuntimeExact, true);
  assert.equal(out.deterministic, true);
  assert.equal(out.affectsExecution, false);
});

test("derives DOWN without using option side", () => {
  const out = deriveH1ExactLiveSpotDirection(
    spot("SENSEX", "2026-09-04T04:00:00.000Z", 80000),
    spot("SENSEX", "2026-09-04T04:00:05.000Z", 79920),
    policy,
  );
  assert.equal(out.ready, true);
  assert.equal(out.direction, "DOWN");
});

test("small move remains unavailable rather than inventing direction", () => {
  const out = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000),
    spot("NIFTY", "2026-09-04T04:00:05.000Z", 24006),
    policy,
  );
  assert.equal(out.ready, false);
  assert.equal(out.direction, null);
  assert.ok(out.blockers.includes("SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"));
});

test("cross-symbol, reverse chronology and excessive gap fail closed", () => {
  const cross = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000),
    spot("BANKNIFTY", "2026-09-04T04:00:05.000Z", 57000), policy);
  assert.equal(cross.ready, false);
  assert.ok(cross.blockers.includes("SPOT_SYMBOL_MISMATCH"));

  const reverse = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:05.000Z", 24000),
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24100), policy);
  assert.equal(reverse.ready, false);
  assert.ok(reverse.blockers.includes("NON_FORWARD_SPOT_CHRONOLOGY"));

  const gap = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000),
    spot("NIFTY", "2026-09-04T04:00:11.000Z", 24100), policy);
  assert.equal(gap.ready, false);
  assert.ok(gap.blockers.includes("SPOT_OBSERVATION_GAP_EXCEEDED"));
});

test("invalid policy or non-exact evidence fails closed", () => {
  const invalidPolicy = deriveH1ExactLiveSpotDirection(
    spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000),
    spot("NIFTY", "2026-09-04T04:00:05.000Z", 24100),
    { maxObservationGapMs: 0, minAbsoluteSpotMovePct: -1 },
  );
  assert.equal(invalidPolicy.ready, false);
  assert.ok(invalidPolicy.blockers.includes("DIRECTION_POLICY_INVALID"));

  const bad = spot("NIFTY", "2026-09-04T04:00:00.000Z", 24000) as any;
  bad.source = "REPLAY";
  const nonExact = deriveH1ExactLiveSpotDirection(bad, spot("NIFTY", "2026-09-04T04:00:05.000Z", 24100), policy);
  assert.equal(nonExact.ready, false);
  assert.ok(nonExact.blockers.includes("LIVE_RUNTIME_EXACT_SPOT_PAIR_REQUIRED"));
});
