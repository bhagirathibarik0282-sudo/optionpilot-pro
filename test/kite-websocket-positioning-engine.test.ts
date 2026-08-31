import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateEventTruthRecorder } from "../immediate-event-truth-recorder.js";
import { ImmediateMetricIngestBridge } from "../immediate-metric-ingest-bridge.js";
import { KiteWebSocketPositioningEngine } from "../kite-websocket-positioning-engine.js";

function engine() {
  const truth = new ImmediateEventTruthRecorder();
  const bridge = new ImmediateMetricIngestBridge(truth);
  const positioning = new KiteWebSocketPositioningEngine({
    symbol: "NIFTY",
    expiry: "2026-09-01",
    maxObservationAgeMs: 5_000,
    pcrRisingEffect: "FAVOURS_CE",
    pcrFallingEffect: "FAVOURS_PE",
    optionTokens: [
      { instrumentToken: 1, strike: 24000, side: "CE" },
      { instrumentToken: 2, strike: 24050, side: "CE" },
      { instrumentToken: 3, strike: 24000, side: "PE" },
      { instrumentToken: 4, strike: 24050, side: "PE" },
    ],
  }, bridge, truth);
  return { truth, positioning };
}

function obs(token: number, strike: number, side: "CE" | "PE", oi: number, second = 0) {
  const occurredAt = new Date(Date.UTC(2026, 7, 31, 6, 0, second)).toISOString();
  return {
    symbol: "NIFTY" as const,
    instrumentToken: token,
    instrumentLabel: `NIFTY-${strike}-${side}`,
    expiry: "2026-09-01",
    strike,
    side,
    oi,
    occurredAt,
    receivedAt: new Date(Date.UTC(2026, 7, 31, 6, 0, second, 100)).toISOString(),
  };
}

test("does not compute PCR or walls until the fixed token universe is complete", () => {
  const { positioning } = engine();
  const result = positioning.ingest(obs(1, 24000, "CE", 100), "CE");
  assert.equal(result.snapshot.complete, false);
  assert.equal(result.snapshot.pcr, null);
  assert.equal(result.detectorResults.length, 0);
});

test("computes synchronized fixed-universe PCR and walls from WebSocket OI only", () => {
  const { positioning } = engine();
  positioning.ingest(obs(1, 24000, "CE", 100), "CE");
  positioning.ingest(obs(2, 24050, "CE", 200), "CE");
  positioning.ingest(obs(3, 24000, "PE", 300), "CE");
  const result = positioning.ingest(obs(4, 24050, "PE", 100), "CE");
  assert.equal(result.snapshot.complete, true);
  assert.equal(result.snapshot.fresh, true);
  assert.equal(result.snapshot.ceOiTotal, 300);
  assert.equal(result.snapshot.peOiTotal, 400);
  assert.equal(result.snapshot.pcr, 400 / 300);
  assert.deepEqual(result.snapshot.callWall, { strike: 24050, oi: 200 });
  assert.deepEqual(result.snapshot.putWall, { strike: 24000, oi: 300 });
  assert.equal(result.detectorResults.length, 3);
});

test("wall migration is not misclassified as same-strike OI shedding", () => {
  const { truth, positioning } = engine();
  positioning.ingest(obs(1, 24000, "CE", 100), "CE");
  positioning.ingest(obs(2, 24050, "CE", 200), "CE");
  positioning.ingest(obs(3, 24000, "PE", 300), "CE");
  positioning.ingest(obs(4, 24050, "PE", 100), "CE");
  const result = positioning.ingest(obs(1, 24000, "CE", 500, 1), "CE");
  assert.deepEqual(result.snapshot.callWall, { strike: 24000, oi: 500 });
  assert.equal(result.migrationTruthRecords.length, 1);
  const rows = truth.list("NIFTY", 10);
  const migration = rows.find((x) => x.event.fact.includes("Call wall migrated"));
  assert.equal(migration?.event.alignment, "NEUTRAL");
});

test("stale member makes whole positioning snapshot non-fresh and suppresses derived detector updates", () => {
  const { positioning } = engine();
  positioning.ingest(obs(1, 24000, "CE", 100, 0), "CE");
  positioning.ingest(obs(2, 24050, "CE", 200, 0), "CE");
  positioning.ingest(obs(3, 24000, "PE", 300, 0), "CE");
  const last = obs(4, 24050, "PE", 100, 10);
  const result = positioning.ingest(last, "CE");
  assert.equal(result.snapshot.complete, true);
  assert.equal(result.snapshot.fresh, false);
  assert.equal(result.detectorResults.length, 0);
});
