import { dbIsConfigured, dbQuerySafe } from "./db.ts";
import type { HawkEyeBaseline, HawkEyeFamily, HawkEyeTarget } from "./hawk-eye-business-z-v1.ts";

export interface HawkEyeBaselineSample {
  target: HawkEyeTarget;
  family: HawkEyeFamily;
  feature: string;
  raw: number | null;
  observedAtMs: number;
  sampleId?: string | null;
}

interface HawkEyeStoredBaselineSample extends HawkEyeBaselineSample {
  version: "HAWK_EYE_BASELINE_SAMPLE_V1";
}

export type HawkEyeBaselineStoreReason =
  | "READY"
  | "INSUFFICIENT_HISTORY"
  | "ZERO_VARIANCE"
  | "INVALID_SAMPLE"
  | "DB_NOT_CONFIGURED"
  | "DB_READ_FAILED"
  | "DB_WRITE_FAILED";

export interface HawkEyeBaselineStoreResult {
  baseline: HawkEyeBaseline | null;
  sampleCount: number;
  persisted: boolean;
  reason: HawkEyeBaselineStoreReason;
  historyLimit: number;
}

export interface HawkEyeBaselineStoreDeps {
  isConfigured: () => boolean;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] } | null>;
}

const MIN_BASELINE_SAMPLES = 30;
const HISTORY_LIMIT = 240;
const SD_EPS = 1e-9;
const KIND_PREFIX = "HAWK_EYE_BASELINE_SAMPLE_V1";

const defaultDeps: HawkEyeBaselineStoreDeps = {
  isConfigured: dbIsConfigured,
  query: dbQuerySafe,
};

function finite(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function kindFor(sample: Pick<HawkEyeBaselineSample, "target" | "family" | "feature">): string {
  return `${KIND_PREFIX}:${sample.target}:${sample.family}:${encodeURIComponent(sample.feature.trim())}`;
}

function normalizeCurrent(sample: HawkEyeBaselineSample): HawkEyeStoredBaselineSample | null {
  const raw = finite(sample.raw);
  const observedAtMs = finite(sample.observedAtMs);
  const feature = sample.feature?.trim();
  if (raw === null || observedAtMs === null || observedAtMs <= 0 || !feature) return null;
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

function previousValuesOnly(
  rows: HawkEyeStoredBaselineSample[],
  current: HawkEyeStoredBaselineSample,
): number[] {
  const byTimestamp = new Map<number, number>();
  for (const row of rows) {
    if (!row || row.version !== "HAWK_EYE_BASELINE_SAMPLE_V1") continue;
    if (row.target !== current.target || row.family !== current.family || row.feature !== current.feature) continue;
    const raw = finite(row.raw);
    const observedAtMs = finite(row.observedAtMs);
    if (raw === null || observedAtMs === null || observedAtMs >= current.observedAtMs) continue;
    // A repeated write for the same feature/timestamp is one logical observation.
    byTimestamp.set(Math.trunc(observedAtMs), raw);
  }
  return [...byTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-HISTORY_LIMIT)
    .map(([, raw]) => raw);
}

function baselineFromValues(values: number[]): HawkEyeBaseline | null {
  if (values.length < MIN_BASELINE_SAMPLES) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  const sd = Math.sqrt(Math.max(0, variance));
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= SD_EPS) return null;
  return { mean, sd, sampleCount: values.length };
}

/**
 * Reads only prior observations, computes a target/family/feature-isolated baseline,
 * then records the current observation. The current sample can never contribute to
 * its own Z baseline. Any DB read/write failure returns baseline=null (fail closed).
 * This module is persistence/calibration only and has no selector/execution wiring.
 */
export async function loadHawkEyeBaselineAndRecordCurrent(
  sample: HawkEyeBaselineSample,
  deps: HawkEyeBaselineStoreDeps = defaultDeps,
): Promise<HawkEyeBaselineStoreResult> {
  const current = normalizeCurrent(sample);
  if (!current) {
    return { baseline: null, sampleCount: 0, persisted: false, reason: "INVALID_SAMPLE", historyLimit: HISTORY_LIMIT };
  }
  if (!deps.isConfigured()) {
    return { baseline: null, sampleCount: 0, persisted: false, reason: "DB_NOT_CONFIGURED", historyLimit: HISTORY_LIMIT };
  }

  const kind = kindFor(current);
  const loaded = await deps.query<{ payload: HawkEyeStoredBaselineSample }>(
    `SELECT payload
       FROM app_state_log
      WHERE kind = $1
        AND (payload->>'observedAtMs') ~ '^[0-9]+$'
        AND (payload->>'observedAtMs')::bigint < $2
      ORDER BY (payload->>'observedAtMs')::bigint DESC, id DESC
      LIMIT $3`,
    [kind, current.observedAtMs, HISTORY_LIMIT * 2],
  );
  if (!loaded) {
    return { baseline: null, sampleCount: 0, persisted: false, reason: "DB_READ_FAILED", historyLimit: HISTORY_LIMIT };
  }

  const values = previousValuesOnly(loaded.rows.map((row) => row.payload), current);
  const baseline = baselineFromValues(values);

  const inserted = await deps.query<{ id: string | number }>(
    `INSERT INTO app_state_log (kind, payload)
     SELECT $1, $2::jsonb
      WHERE NOT EXISTS (
        SELECT 1
          FROM app_state_log
         WHERE kind = $1
           AND payload->>'observedAtMs' = $3
      )
     RETURNING id`,
    [kind, JSON.stringify(current), String(current.observedAtMs)],
  );
  if (!inserted) {
    return { baseline: null, sampleCount: values.length, persisted: false, reason: "DB_WRITE_FAILED", historyLimit: HISTORY_LIMIT };
  }

  if (values.length < MIN_BASELINE_SAMPLES) {
    return { baseline: null, sampleCount: values.length, persisted: true, reason: "INSUFFICIENT_HISTORY", historyLimit: HISTORY_LIMIT };
  }
  if (!baseline) {
    return { baseline: null, sampleCount: values.length, persisted: true, reason: "ZERO_VARIANCE", historyLimit: HISTORY_LIMIT };
  }
  return { baseline, sampleCount: values.length, persisted: true, reason: "READY", historyLimit: HISTORY_LIMIT };
}

export const HAWK_EYE_BASELINE_STORE_V1_LIMITS = Object.freeze({
  minBaselineSamples: MIN_BASELINE_SAMPLES,
  historyLimit: HISTORY_LIMIT,
});
