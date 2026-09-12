import { dbIsConfigured, dbQuerySafe } from "./db.ts";
import type { HawkEyeBaseline } from "./hawk-eye-business-z-v1.ts";
import type {
  HawkEyeBaselineSample,
  HawkEyeBaselineStoreReason,
  HawkEyeBaselineStoreResult,
} from "./hawk-eye-baseline-store-v1.ts";

export interface HawkEyeBaselineBatchDeps {
  isConfigured: () => boolean;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] } | null>;
}

interface StoredSample extends HawkEyeBaselineSample {
  version: "HAWK_EYE_BASELINE_SAMPLE_V1";
}

interface HistoryRow {
  kind: string;
  payload: StoredSample;
}

const KIND_PREFIX = "HAWK_EYE_BASELINE_SAMPLE_V1";
const MIN_BASELINE_SAMPLES = 30;
const HISTORY_LIMIT = 240;
const SD_EPS = 1e-9;
const MAX_BATCH_SAMPLES = 540;

const defaultDeps: HawkEyeBaselineBatchDeps = {
  isConfigured: dbIsConfigured,
  query: dbQuerySafe,
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(sample: HawkEyeBaselineSample): StoredSample | null {
  const raw = finite(sample?.raw);
  const observedAtMs = finite(sample?.observedAtMs);
  const feature = typeof sample?.feature === "string" ? sample.feature.trim() : "";
  if (raw === null || observedAtMs === null || observedAtMs <= 0 || !feature) return null;
  if (!(["NIFTY", "BANKNIFTY", "SENSEX"] as const).includes(sample.target)) return null;
  if (!(["SISTERS", "HEAVYWEIGHTS", "SECTORS"] as const).includes(sample.family)) return null;
  return {
    version: "HAWK_EYE_BASELINE_SAMPLE_V1",
    target: sample.target,
    family: sample.family,
    feature,
    raw,
    observedAtMs: Math.trunc(observedAtMs),
    sampleId: sample.sampleId?.trim() || null,
  };
}

function kindFor(sample: Pick<StoredSample, "target" | "family" | "feature">): string {
  return `${KIND_PREFIX}:${sample.target}:${sample.family}:${encodeURIComponent(sample.feature)}`;
}

function baseline(values: number[]): HawkEyeBaseline | null {
  if (values.length < MIN_BASELINE_SAMPLES) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  const sd = Math.sqrt(Math.max(0, variance));
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= SD_EPS) return null;
  return { mean, sd, sampleCount: values.length };
}

function result(reason: HawkEyeBaselineStoreReason, sampleCount = 0, persisted = false, value: HawkEyeBaseline | null = null): HawkEyeBaselineStoreResult {
  return { baseline: value, sampleCount, persisted, reason, historyLimit: HISTORY_LIMIT };
}

/**
 * Batch persistent baseline loader for Hawk Eye runtime use.
 * One history SELECT + one current-sample INSERT for the entire report.
 * Current/future samples are excluded in JS per exact target/family/feature timestamp,
 * and duplicates are collapsed by logical timestamp before the baseline is calculated.
 * Any DB read/write failure fails the whole batch closed so partial ratings cannot leak.
 */
export async function loadHawkEyeBaselinesAndRecordCurrentBatch(
  samples: HawkEyeBaselineSample[],
  deps: HawkEyeBaselineBatchDeps = defaultDeps,
): Promise<HawkEyeBaselineStoreResult[]> {
  const input = Array.isArray(samples) ? samples.slice(0, MAX_BATCH_SAMPLES) : [];
  const normalized = input.map(normalize);
  if (!deps.isConfigured()) return normalized.map((row) => row ? result("DB_NOT_CONFIGURED") : result("INVALID_SAMPLE"));

  const validRows = normalized.filter((row): row is StoredSample => row !== null);
  if (!validRows.length) return normalized.map(() => result("INVALID_SAMPLE"));

  const kinds = [...new Set(validRows.map(kindFor))];
  const loaded = await deps.query<HistoryRow>(
    `WITH ranked AS (
       SELECT kind, payload,
              row_number() OVER (PARTITION BY kind ORDER BY (payload->>'observedAtMs')::bigint DESC, id DESC) AS rn
         FROM app_state_log
        WHERE kind = ANY($1::text[])
          AND (payload->>'observedAtMs') ~ '^[0-9]+$'
     )
     SELECT kind, payload
       FROM ranked
      WHERE rn <= $2`,
    [kinds, HISTORY_LIMIT * 2],
  );
  if (!loaded) return normalized.map((row) => row ? result("DB_READ_FAILED") : result("INVALID_SAMPLE"));

  const historyByKind = new Map<string, StoredSample[]>();
  for (const row of loaded.rows ?? []) {
    if (!row?.kind || !row.payload || row.payload.version !== "HAWK_EYE_BASELINE_SAMPLE_V1") continue;
    const bucket = historyByKind.get(row.kind) ?? [];
    bucket.push(row.payload);
    historyByKind.set(row.kind, bucket);
  }

  const currentUnique = new Map<string, StoredSample>();
  for (const row of validRows) {
    const key = `${kindFor(row)}|${row.observedAtMs}`;
    if (!currentUnique.has(key)) currentUnique.set(key, row);
  }
  const inserts = [...currentUnique.values()];
  const insertKinds = inserts.map(kindFor);
  const insertPayloads = inserts.map((row) => JSON.stringify(row));
  const insertTimes = inserts.map((row) => String(row.observedAtMs));
  const written = await deps.query<{ id: string | number }>(
    `WITH incoming AS (
       SELECT * FROM unnest($1::text[], $2::jsonb[], $3::text[]) AS x(kind, payload, observed_at)
     )
     INSERT INTO app_state_log (kind, payload)
     SELECT i.kind, i.payload
       FROM incoming i
      WHERE NOT EXISTS (
        SELECT 1 FROM app_state_log a
         WHERE a.kind = i.kind
           AND a.payload->>'observedAtMs' = i.observed_at
      )
     RETURNING id`,
    [insertKinds, insertPayloads, insertTimes],
  );
  if (!written) return normalized.map((row) => row ? result("DB_WRITE_FAILED") : result("INVALID_SAMPLE"));

  return normalized.map((current) => {
    if (!current) return result("INVALID_SAMPLE");
    const byTimestamp = new Map<number, number>();
    for (const old of historyByKind.get(kindFor(current)) ?? []) {
      if (old.target !== current.target || old.family !== current.family || old.feature !== current.feature) continue;
      const oldTime = finite(old.observedAtMs);
      const oldRaw = finite(old.raw);
      if (oldTime === null || oldRaw === null || oldTime >= current.observedAtMs) continue;
      byTimestamp.set(Math.trunc(oldTime), oldRaw);
    }
    const values = [...byTimestamp.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-HISTORY_LIMIT)
      .map(([, raw]) => raw);
    if (values.length < MIN_BASELINE_SAMPLES) return result("INSUFFICIENT_HISTORY", values.length, true);
    const calculated = baseline(values);
    if (!calculated) return result("ZERO_VARIANCE", values.length, true);
    return result("READY", values.length, true, calculated);
  });
}

export const HAWK_EYE_BASELINE_BATCH_V1_LIMITS = Object.freeze({
  minBaselineSamples: MIN_BASELINE_SAMPLES,
  historyLimit: HISTORY_LIMIT,
  maxBatchSamples: MAX_BATCH_SAMPLES,
  expectedDbCallsPerReadyBatch: 2,
});
