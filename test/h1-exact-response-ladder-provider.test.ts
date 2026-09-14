import assert from "node:assert/strict";
import test from "node:test";
import { deriveH1ExactResponseLadder, type H1ExactResponsePoint } from "../h1-exact-response-ladder-provider.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";

const now = Date.now();

function direction(up = true) {
  const previousAt = new Date(now - 90_000).toISOString();
  const currentAt = new Date(now - 30_000).toISOString();
  return deriveH1ExactLiveSpotDirection(
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: up ? 25000 : 25050, observedAt: previousAt, receivedAt: new Date(now - 89_000).toISOString() },
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: up ? 25050 : 25000, observedAt: currentAt, receivedAt: new Date(now - 29_000).toISOString() },
    { maxObservationGapMs: 120_000, minAbsoluteSpotMovePct: 0.1 },
  );
}

function points(minutesBack: number, up = true): H1ExactResponsePoint[] {
  const out: H1ExactResponsePoint[] = [];
  for (let minute = minutesBack; minute >= 0; minute -= 3) {
    const elapsed = minutesBack - minute;
    out.push({
      provenance: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      observedAtMs: now - minute * 60_000 - 30_000,
      spot: up ? 25000 + elapsed * 5 : 25050 - elapsed * 5,
      sourceId: "SERVER_SNAPSHOT_HISTORY_EXACT",
      devilFlags: [],
    });
  }
  return out;
}

const policy = {
  maxLatestAgeMs: 90_000,
  minWindowCoveragePct: 90,
  minSamplesPerStage: 2,
  requiredMatureStages: 3,
  minAbsoluteMovePctByWindow: { 3: 0.01, 6: 0.02, 15: 0.04, 30: 0.08 },
} as const;

test("confirms the first three elapsed-time stages without fabricating 30m maturity", () => {
  const out = deriveH1ExactResponseLadder({ symbol: "NIFTY", directionSource: direction(true), points: points(15, true), policy, nowMs: now });
  assert.equal(out.ready, true);
  assert.equal(out.direction, "UP");
  assert.equal(out.matureStages, 3);
  assert.equal(out.confirmedStages, 3);
  assert.equal(out.totalStages, 4);
  assert.equal(out.stages.find((stage) => stage.windowMinutes === 30)?.mature, false);
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("confirms all four stages when 30m exact history is available", () => {
  const out = deriveH1ExactResponseLadder({ symbol: "NIFTY", directionSource: direction(true), points: points(30, true), policy, nowMs: now });
  assert.equal(out.ready, true);
  assert.equal(out.matureStages, 4);
  assert.equal(out.confirmedStages, 4);
});

test("opposite response does not become directional confirmation", () => {
  const out = deriveH1ExactResponseLadder({ symbol: "NIFTY", directionSource: direction(true), points: points(15, false), policy, nowMs: now });
  assert.equal(out.ready, true);
  assert.equal(out.matureStages, 3);
  assert.equal(out.confirmedStages, 0);
  assert.equal(out.stages.filter((stage) => stage.mature).every((stage) => stage.blocker === "DIRECTION_OR_MOVE_THRESHOLD_NOT_CONFIRMED"), true);
});

test("stale latest history fails closed", () => {
  const stale = points(15, true).map((point) => ({ ...point, observedAtMs: point.observedAtMs - 10 * 60_000 }));
  const out = deriveH1ExactResponseLadder({ symbol: "NIFTY", directionSource: direction(true), points: stale, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["RESPONSE_HISTORY_LATEST_STALE_OR_FUTURE"]);
});

test("insufficient elapsed coverage remains immature even with enough sample rows", () => {
  const compressed: H1ExactResponsePoint[] = [0, 30, 60, 90].map((seconds, index) => ({
    provenance: "LIVE_RUNTIME_EXACT" as const,
    symbol: "NIFTY" as const,
    observedAtMs: now - 30_000 - (90 - seconds) * 1000,
    spot: 25000 + index * 10,
    sourceId: "SERVER_SNAPSHOT_HISTORY_EXACT",
    devilFlags: [],
  }));
  const out = deriveH1ExactResponseLadder({ symbol: "NIFTY", directionSource: direction(true), points: compressed, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.equal(out.matureStages, 0);
  assert.ok(out.blockers.includes("RESPONSE_LADDER_NOT_MATURE"));
});
