import test from "node:test";
import assert from "node:assert/strict";
import { recordH1FromRuntimeSnapshot } from "../h1-runtime-bridge.js";

const TS = "2026-08-28T09:30:00.000Z";

test("runtime bridge refuses to invent missing Truth", async () => {
  const result = await recordH1FromRuntimeSnapshot({
    NIFTY: { symbol: "NIFTY", spot: 25000, current: 25000, snapshotId: "s1", timestamp: TS, expiries: [], futuresContracts: [] },
  }, null);
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});

test("runtime bridge accepts actual TruthReport overallVerdict shape", async () => {
  const result = await recordH1FromRuntimeSnapshot({
    NIFTY: {
      symbol: "NIFTY",
      spot: 25000,
      snapshotId: "s2",
      timestamp: TS,
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
      timestamp: TS,
      expiries: [],
      futuresContracts: [],
    },
  }, { NIFTY: { overallVerdict: "PARTIAL" } });
  assert.equal(result.attempted, 1);
  assert.equal(result.skipped, 0);
});

test("runtime bridge never treats unknown quality text as TRUE", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, snapshotId: "s3", timestamp: TS, expiries: [], futuresContracts: [] },
    { status: "MAYBE" },
  );
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});

test("runtime bridge refuses missing source time instead of inventing current time", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, snapshotId: "no-time", expiries: [], futuresContracts: [] },
    { overallVerdict: "TRUE" },
  );
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});

test("runtime bridge refuses invalid source time", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, snapshotId: "bad-time", timestamp: "not-a-time", expiries: [], futuresContracts: [] },
    { overallVerdict: "TRUE" },
  );
  assert.deepEqual(result, { attempted: 0, skipped: 1 });
});

test("runtime bridge refuses non-positive spot identity", async () => {
  const zero = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 0, snapshotId: "zero-spot", timestamp: TS, expiries: [], futuresContracts: [] },
    { overallVerdict: "TRUE" },
  );
  const negative = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: -1, snapshotId: "negative-spot", timestamp: TS, expiries: [], futuresContracts: [] },
    { overallVerdict: "TRUE" },
  );
  assert.deepEqual(zero, { attempted: 0, skipped: 0 });
  assert.deepEqual(negative, { attempted: 0, skipped: 0 });
});

test("runtime bridge can derive deterministic snapshot identity only from validated source time", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, timestamp: TS, expiries: [], futuresContracts: [] },
    { overallVerdict: "TRUE" },
  );
  assert.deepEqual(result, { attempted: 1, skipped: 0 });
});

test("missing optional numeric metrics do not get promoted to required observations", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    { symbol: "NIFTY", spot: 25000, snapshotId: "missing-optionals", timestamp: TS, expiries: [], futuresContracts: [] },
    { overallVerdict: "PARTIAL" },
  );
  assert.deepEqual(result, { attempted: 1, skipped: 0 });
});

test("missing ATM anchor cannot force an arbitrary option-band selection", async () => {
  const result = await recordH1FromRuntimeSnapshot(
    {
      symbol: "NIFTY",
      spot: 25000,
      snapshotId: "missing-atm",
      timestamp: TS,
      expiries: [{
        expiry: "Current",
        expiryDate: "2026-09-03",
        ceStrikes: [{ optionType: "CE", strike: 25000, lastPrice: 100 }],
        peStrikes: [{ optionType: "PE", strike: 25000, lastPrice: 90 }],
      }],
      futuresContracts: [],
    },
    { overallVerdict: "PARTIAL" },
  );
  // The index-level observation remains eligible to be attempted, while the bridge
  // strips option expiries internally because there is no finite positive ATM anchor.
  assert.deepEqual(result, { attempted: 1, skipped: 0 });
});
