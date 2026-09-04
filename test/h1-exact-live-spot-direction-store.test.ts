import assert from "node:assert/strict";
import test from "node:test";
import { H1ExactLiveSpotDirectionStore } from "../h1-exact-live-spot-direction-store.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY SPOT" },
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
]);

function fullIndex(ts: string, price: number) {
  return {
    mode: "full",
    instrumentToken: 256265,
    isIndex: true,
    lastPrice: price,
    exchangeTimestamp: ts,
  } as any;
}

const policy = { maxObservationGapMs: 10_000, minAbsoluteSpotMovePct: 0.05 };

test("first exact SPOT observation seeds baseline without inventing direction", () => {
  const store = new H1ExactLiveSpotDirectionStore({ registry, policy });
  const out = store.ingest(fullIndex("2026-09-04T04:00:00.000Z", 24000), "2026-09-04T04:00:00.000Z");
  assert.equal(out.accepted, true);
  assert.equal(out.seeded, true);
  assert.equal(out.direction, null);
  assert.equal(store.directionFor("NIFTY"), null);
});

test("second forward exact SPOT observation exposes verified direction", () => {
  const store = new H1ExactLiveSpotDirectionStore({ registry, policy });
  store.ingest(fullIndex("2026-09-04T04:00:00.000Z", 24000), "2026-09-04T04:00:00.000Z");
  const out = store.ingest(fullIndex("2026-09-04T04:00:05.000Z", 24024), "2026-09-04T04:00:05.000Z");
  assert.equal(out.accepted, true);
  assert.equal(out.direction?.ready, true);
  assert.equal(out.direction?.direction, "UP");
  assert.equal(store.directionFor("NIFTY")?.sourceId, "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1");
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
});

test("below-threshold evidence clears usable direction rather than carrying stale state", () => {
  const store = new H1ExactLiveSpotDirectionStore({ registry, policy });
  store.ingest(fullIndex("2026-09-04T04:00:00.000Z", 24000), "2026-09-04T04:00:00.000Z");
  store.ingest(fullIndex("2026-09-04T04:00:05.000Z", 24024), "2026-09-04T04:00:05.000Z");
  const out = store.ingest(fullIndex("2026-09-04T04:00:10.000Z", 24025), "2026-09-04T04:00:10.000Z");
  assert.equal(out.accepted, false);
  assert.equal(store.directionFor("NIFTY")?.ready, false);
  assert.equal(store.directionFor("NIFTY")?.direction, null);
  assert.ok(store.directionFor("NIFTY")?.blockers.includes("SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"));
});

test("non-forward SPOT chronology fails closed and is not promoted", () => {
  const store = new H1ExactLiveSpotDirectionStore({ registry, policy });
  store.ingest(fullIndex("2026-09-04T04:00:05.000Z", 24000), "2026-09-04T04:00:05.000Z");
  const reverse = store.ingest(fullIndex("2026-09-04T04:00:04.000Z", 24100), "2026-09-04T04:00:05.000Z");
  assert.equal(reverse.accepted, false);
  assert.equal(reverse.blocker, "NON_FORWARD_EXACT_SPOT_CHRONOLOGY");
  assert.equal(store.directionFor("NIFTY"), null);

  const recovered = store.ingest(fullIndex("2026-09-04T04:00:10.000Z", 24024), "2026-09-04T04:00:10.000Z");
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.direction?.direction, "UP");
});

test("non-SPOT and stale/invalid SPOT packets never create direction", () => {
  const store = new H1ExactLiveSpotDirectionStore({ registry, policy, maxUnderlyingAgeMs: 5_000 });
  const nonSpot = store.ingest({ mode: "full", instrumentToken: 111, isIndex: false, lastPrice: 100, exchangeTimestamp: "2026-09-04T04:00:00.000Z" } as any, "2026-09-04T04:00:00.000Z");
  assert.equal(nonSpot.accepted, false);
  assert.equal(nonSpot.blocker, "NON_SPOT_IGNORED");

  const stale = store.ingest(fullIndex("2026-09-04T04:00:00.000Z", 24000), "2026-09-04T04:00:06.000Z");
  assert.equal(stale.accepted, false);
  assert.equal(stale.blocker, "INVALID_EXACT_SPOT_OBSERVATION");
  assert.equal(store.directionFor("NIFTY"), null);
});
