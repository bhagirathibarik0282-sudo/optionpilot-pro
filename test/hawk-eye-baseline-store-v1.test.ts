import test from "node:test";
import assert from "node:assert/strict";
import {
  HAWK_EYE_BASELINE_STORE_V1_LIMITS,
  loadHawkEyeBaselineAndRecordCurrent,
  type HawkEyeBaselineSample,
  type HawkEyeBaselineStoreDeps,
} from "../hawk-eye-baseline-store-v1.ts";

type Stored = HawkEyeBaselineSample & { version: "HAWK_EYE_BASELINE_SAMPLE_V1" };

function stored(raw: number, observedAtMs: number, overrides: Partial<Stored> = {}): Stored {
  return {
    version: "HAWK_EYE_BASELINE_SAMPLE_V1",
    target: "NIFTY",
    family: "HEAVYWEIGHTS",
    feature: "HDFCBANK_3M",
    raw,
    observedAtMs,
    sampleId: null,
    ...overrides,
  };
}

function sample(raw = 100, observedAtMs = 10_000): HawkEyeBaselineSample {
  return { target: "NIFTY", family: "HEAVYWEIGHTS", feature: "HDFCBANK_3M", raw, observedAtMs };
}

function deps(rows: Stored[], options: { configured?: boolean; failRead?: boolean; failWrite?: boolean } = {}) {
  let calls = 0;
  let insertedPayload: Stored | null = null;
  const value: HawkEyeBaselineStoreDeps = {
    isConfigured: () => options.configured ?? true,
    query: async <T>(_sql: string, params: unknown[] = []) => {
      calls += 1;
      if (calls === 1) {
        if (options.failRead) return null;
        return { rows: rows.map((payload) => ({ payload })) as T[] };
      }
      if (options.failWrite) return null;
      insertedPayload = JSON.parse(String(params[1])) as Stored;
      return { rows: [{ id: 1 }] as T[] };
    },
  };
  return { value, getInserted: () => insertedPayload, getCalls: () => calls };
}

test("current sample is excluded from its own baseline", async () => {
  const history = Array.from({ length: 30 }, (_, i) => stored(i + 1, i + 1));
  history.push(stored(1_000_000, 10_000));
  const mock = deps(history);
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(1_000_000, 10_000), mock.value);
  assert.equal(result.reason, "READY");
  assert.equal(result.sampleCount, 30);
  assert.equal(result.baseline?.mean, 15.5);
  assert.equal(mock.getInserted()?.raw, 1_000_000);
});

test("target family and feature contamination is rejected defensively", async () => {
  const valid = Array.from({ length: 30 }, (_, i) => stored(i + 1, i + 1));
  const mixed = [
    ...valid,
    stored(999, 100, { target: "BANKNIFTY" }),
    stored(999, 101, { family: "SECTORS" }),
    stored(999, 102, { feature: "RELIANCE_3M" }),
  ];
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(31, 10_000), deps(mixed).value);
  assert.equal(result.reason, "READY");
  assert.equal(result.sampleCount, 30);
  assert.equal(result.baseline?.mean, 15.5);
});

test("fewer than 30 previous samples stays not ready but records current sample", async () => {
  const history = Array.from({ length: 29 }, (_, i) => stored(i + 1, i + 1));
  const mock = deps(history);
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(30, 100), mock.value);
  assert.equal(result.reason, "INSUFFICIENT_HISTORY");
  assert.equal(result.baseline, null);
  assert.equal(result.sampleCount, 29);
  assert.equal(result.persisted, true);
});

test("DB read failure fails closed and does not attempt a write", async () => {
  const mock = deps([], { failRead: true });
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(), mock.value);
  assert.equal(result.reason, "DB_READ_FAILED");
  assert.equal(result.baseline, null);
  assert.equal(result.persisted, false);
  assert.equal(mock.getCalls(), 1);
});

test("DB write failure discards an otherwise ready baseline", async () => {
  const history = Array.from({ length: 30 }, (_, i) => stored(i + 1, i + 1));
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(31, 100), deps(history, { failWrite: true }).value);
  assert.equal(result.reason, "DB_WRITE_FAILED");
  assert.equal(result.baseline, null);
  assert.equal(result.persisted, false);
  assert.equal(result.sampleCount, 30);
});

test("history is deterministic, de-duplicated by timestamp, and bounded", async () => {
  const limit = HAWK_EYE_BASELINE_STORE_V1_LIMITS.historyLimit;
  const history = Array.from({ length: limit + 60 }, (_, i) => stored(i + 1, i + 1));
  history.reverse();
  history.push(stored(-999, 10));
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(999, 100_000), deps(history).value);
  assert.equal(result.reason, "READY");
  assert.equal(result.sampleCount, limit);
  const expectedFirst = 61;
  const expectedLast = 300;
  assert.equal(result.baseline?.mean, (expectedFirst + expectedLast) / 2);
});

test("unconfigured DB fails closed without creating in-memory substitute history", async () => {
  const mock = deps([], { configured: false });
  const result = await loadHawkEyeBaselineAndRecordCurrent(sample(), mock.value);
  assert.equal(result.reason, "DB_NOT_CONFIGURED");
  assert.equal(result.baseline, null);
  assert.equal(result.persisted, false);
  assert.equal(mock.getCalls(), 0);
});
