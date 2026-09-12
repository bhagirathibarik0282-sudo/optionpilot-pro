import test from "node:test";
import assert from "node:assert/strict";
import { loadHawkEyeBaselinesAndRecordCurrentBatch } from "../hawk-eye-baseline-batch-v1.ts";
import type { HawkEyeBaselineSample } from "../hawk-eye-baseline-store-v1.ts";

const T = 1_000_000;

function sample(target: HawkEyeBaselineSample["target"], feature: string, raw = 5): HawkEyeBaselineSample {
  return { target, family: "HEAVYWEIGHTS", feature, raw, observedAtMs: T, sampleId: "current" };
}

function historyRows(kinds: string[]) {
  return kinds.flatMap((kind) => {
    const [, target, family, encodedFeature] = kind.split(":");
    const feature = decodeURIComponent(encodedFeature);
    return Array.from({ length: 30 }, (_, i) => ({
      kind,
      payload: {
        version: "HAWK_EYE_BASELINE_SAMPLE_V1",
        target,
        family,
        feature,
        raw: i + 1,
        observedAtMs: T - ((30 - i) * 60_000),
        sampleId: `old-${i}`,
      },
    }));
  });
}

test("batch persistence uses one history read and one insert for many target features", async () => {
  let calls = 0;
  const seenKinds: string[] = [];
  const inputs = [sample("NIFTY", "HDFCBANK_RETURN_3M"), sample("BANKNIFTY", "HDFCBANK_RETURN_3M"), sample("SENSEX", "RELIANCE_RETURN_3M")];
  const results = await loadHawkEyeBaselinesAndRecordCurrentBatch(inputs, {
    isConfigured: () => true,
    query: async (sql, params = []) => {
      calls++;
      if (sql.includes("WITH ranked")) {
        const kinds = params[0] as string[];
        seenKinds.push(...kinds);
        return { rows: historyRows(kinds) as any[] };
      }
      return { rows: [{ id: 1 }] as any[] };
    },
  });
  assert.equal(calls, 2);
  assert.equal(results.length, 3);
  assert.ok(results.every((x) => x.reason === "READY" && x.baseline?.sampleCount === 30));
  assert.ok(seenKinds.some((x) => x.includes(":NIFTY:")));
  assert.ok(seenKinds.some((x) => x.includes(":BANKNIFTY:")));
  assert.ok(seenKinds.some((x) => x.includes(":SENSEX:")));
});

test("current and future history rows never enter the baseline", async () => {
  const input = sample("NIFTY", "HDFCBANK_RETURN_3M", 999);
  const results = await loadHawkEyeBaselinesAndRecordCurrentBatch([input], {
    isConfigured: () => true,
    query: async (sql, params = []) => {
      if (!sql.includes("WITH ranked")) return { rows: [{ id: 1 }] as any[] };
      const kind = (params[0] as string[])[0];
      const rows = historyRows([kind]);
      rows.push({ kind, payload: { ...rows[0].payload, raw: 9999, observedAtMs: T } });
      rows.push({ kind, payload: { ...rows[0].payload, raw: 9999, observedAtMs: T + 1 } });
      return { rows: rows as any[] };
    },
  });
  assert.equal(results[0].reason, "READY");
  assert.ok((results[0].baseline?.mean ?? 9999) < 100);
});

test("duplicate historical timestamps count once", async () => {
  const input = sample("NIFTY", "HDFCBANK_RETURN_3M");
  const result = await loadHawkEyeBaselinesAndRecordCurrentBatch([input], {
    isConfigured: () => true,
    query: async (sql, params = []) => {
      if (!sql.includes("WITH ranked")) return { rows: [{ id: 1 }] as any[] };
      const kind = (params[0] as string[])[0];
      const rows = historyRows([kind]);
      rows.push({ kind, payload: { ...rows[0].payload, raw: 500 } });
      return { rows: rows as any[] };
    },
  });
  assert.equal(result[0].reason, "READY");
  assert.equal(result[0].sampleCount, 30);
});

test("DB read or write failure fails the whole valid batch closed", async () => {
  const inputs = [sample("NIFTY", "A"), sample("SENSEX", "B")];
  const readFailed = await loadHawkEyeBaselinesAndRecordCurrentBatch(inputs, {
    isConfigured: () => true,
    query: async () => null,
  });
  assert.ok(readFailed.every((x) => x.reason === "DB_READ_FAILED" && x.baseline === null));

  let calls = 0;
  const writeFailed = await loadHawkEyeBaselinesAndRecordCurrentBatch(inputs, {
    isConfigured: () => true,
    query: async (sql, params = []) => {
      calls++;
      if (sql.includes("WITH ranked")) return { rows: historyRows(params[0] as string[]) as any[] };
      return null;
    },
  });
  assert.equal(calls, 2);
  assert.ok(writeFailed.every((x) => x.reason === "DB_WRITE_FAILED" && x.baseline === null));
});

test("null/invalid samples never become numeric zero observations", async () => {
  const bad = sample("NIFTY", "BAD");
  bad.raw = null;
  const result = await loadHawkEyeBaselinesAndRecordCurrentBatch([bad], {
    isConfigured: () => true,
    query: async () => { throw new Error("should not query"); },
  });
  assert.equal(result[0].reason, "INVALID_SAMPLE");
  assert.equal(result[0].baseline, null);
});
