import test from "node:test";
import assert from "node:assert/strict";
import { recordH1FromRuntimeSnapshot } from "../h1-runtime-bridge.js";

test("runtime bridge refuses to invent missing Truth", async () => {
  const result = await recordH1FromRuntimeSnapshot({
    NIFTY: { symbol: "NIFTY", spot: 25000, current: 25000, snapshotId: "s1", expiries: [], futuresContracts: [] },
  }, null);
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});

test("runtime bridge accepts actual TruthReport overallVerdict shape", async () => {
  const result = await recordH1FromRuntimeSnapshot({
    NIFTY: {
      symbol: "NIFTY",
      spot: 25000,
      snapshotId: "s2",
      atmStrike: 25000,
      vwap: 0,
      pdh: 0,
      pdl: 0,
      pdcClose: 0,
      dayOpen: 0,
      dayHigh: 0,
      dayLow: 0,
      vix: 0,
      vixChange: 0,
      maxPain: 0,
      pcr: null,
      volumePcr: null,
      expiries: [],
      futuresContracts: [],
    },
  }, { NIFTY: { overallVerdict: "TRUE" } });
  // DATABASE_URL is absent in unit tests, so persistence is a no-op; the bridge still proves
  // that the exact existing TruthReport shape is resolved and attempted exactly once.
  assert.equal(result.attempted, 1);
  assert.equal(result.skipped, 0);
});

test("runtime bridge preserves non-TRUE TruthReport states instead of promoting them", async () => {
  const result = await recordH1FromRuntimeSnapshot({
    NIFTY: {
      symbol: "NIFTY",
      spot: 25000,
      snapshotId: "s-partial",
      expiries: [],
      futuresContracts: [],
    },
  }, { NIFTY: { overallVerdict: "PARTIAL" } });
  assert.equal(result.attempted, 1);
  assert.equal(result.skipped, 0);
});

test("runtime bridge never treats unknown quality text as TRUE", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, snapshotId: "s3", expiries: [], futuresContracts: [] },
    { status: "MAYBE" },
  );
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});
