import { createHash } from "node:crypto";
import pg from "pg";
import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";
import {
  buildH1GoldChaseCalibrationSample,
  H1_GOLD_CHASE_CALIBRATION_DATASET_V1,
  type H1GoldChaseCalibrationSample,
} from "./h1-gold-chase-calibration-dataset-v1.js";
import type { H1GoldChaseObservationInput } from "./h1-gold-chase-observation-v1.js";

const { Pool } = pg;

export const H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1 = "H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1" as const;
export const H1_GOLD_CHASE_CALIBRATION_TABLE_V1 = "h1_gold_chase_calibration_samples_v1" as const;

export type H1GoldChasePersistenceState =
  | "PERSISTED"
  | "EXACT_DUPLICATE"
  | "CONFLICT"
  | "NOT_COMPLETE"
  | "DB_UNAVAILABLE"
  | "DB_ERROR";

export interface H1GoldChasePersistenceResult {
  version: typeof H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1;
  state: H1GoldChasePersistenceState;
  durable: boolean;
  sampleKey: string | null;
  payloadDigest: string | null;
  sample: H1GoldChaseCalibrationSample | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  thresholdPolicyDefined: false;
  classificationPolicyDefined: false;
  failClosed: true;
  semantics: "DURABLE_IMMUTABLE_COMPLETE_CHASE_CALIBRATION_SAMPLE_ONLY_EXACT_DUPLICATE_IDEMPOTENT_DIVERGENT_DUPLICATE_CONFLICT";
}

interface PersistedRow {
  sample_key: string;
  snapshot_id: string;
  decision_id: string;
  candidate_key: string;
  t0_observed_at_ms: string | number;
  payload_digest: string;
  payload: H1GoldChaseCalibrationSample;
  created_at: string | Date;
}

let pool: InstanceType<typeof Pool> | null = null;
let initializedForUrl: string | null = null;

function result(
  state: H1GoldChasePersistenceState,
  sample: H1GoldChaseCalibrationSample | null,
  sampleKey: string | null,
  payloadDigest: string | null,
  blockers: string[] = [],
): H1GoldChasePersistenceResult {
  return {
    version: H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1,
    state,
    durable: state === "PERSISTED" || state === "EXACT_DUPLICATE",
    sampleKey,
    payloadDigest,
    sample,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    thresholdPolicyDefined: false,
    classificationPolicyDefined: false,
    failClosed: true,
    semantics: "DURABLE_IMMUTABLE_COMPLETE_CHASE_CALIBRATION_SAMPLE_ONLY_EXACT_DUPLICATE_IDEMPOTENT_DIVERGENT_DUPLICATE_CONFLICT",
  };
}

function canonicalJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function completeSampleBlockers(sample: H1GoldChaseCalibrationSample | null | undefined): string[] {
  if (!sample) return ["SAMPLE_REQUIRED"];
  const blockers: string[] = [];
  if (sample.version !== H1_GOLD_CHASE_CALIBRATION_DATASET_V1) blockers.push("INVALID_SAMPLE_VERSION");
  if (sample.state !== "COMPLETE_SAMPLE" || !sample.readyForDataset) blockers.push("COMPLETE_SAMPLE_REQUIRED");
  if (sample.blockers.length !== 0) blockers.push("SAMPLE_HAS_BLOCKERS");
  if (!sample.snapshotId?.trim() || !sample.decisionId?.trim() || !sample.candidateKey?.trim()) blockers.push("IMMUTABLE_IDENTITY_REQUIRED");
  if (!Number.isFinite(sample.t0ObservedAtMs) || Number(sample.t0ObservedAtMs) <= 0) blockers.push("VALID_T0_TIMESTAMP_REQUIRED");
  if (!(typeof sample.t0Premium === "number" && Number.isFinite(sample.t0Premium) && sample.t0Premium > 0)) blockers.push("VALID_T0_PREMIUM_REQUIRED");
  if (!sample.t0Features) blockers.push("T0_FEATURES_REQUIRED");
  const expected = ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"];
  if (sample.outcomes.length !== 4 || expected.some((window) => !sample.outcomes.some((outcome) => outcome.window === window))) blockers.push("ALL_FORWARD_WINDOWS_REQUIRED");
  if (sample.missingWindows.length !== 0) blockers.push("MISSING_FORWARD_WINDOWS_NOT_ALLOWED");
  if (sample.chaseLabel !== null || sample.outcomeLabel !== null || sample.thresholdPolicy !== null) blockers.push("LABEL_OR_THRESHOLD_NOT_ALLOWED");
  if (sample.classificationPolicyDefined || sample.sampleSufficiencyPolicyDefined) blockers.push("POLICY_MUST_REMAIN_UNDEFINED");
  if (sample.productionImpact !== "NONE" || sample.affectsGoldEligibility || sample.affectsSelector || sample.affectsTelegram || sample.affectsExecution || sample.grantsPromotionAuthority || sample.createsOrders) {
    blockers.push("AUTHORITY_NOT_ALLOWED");
  }
  if (!sample.usesPostT0Outcome || !sample.failClosed) blockers.push("INVALID_SAMPLE_SAFETY_FLAGS");
  return [...new Set(blockers)];
}

export function deriveH1GoldChaseCalibrationSampleKey(sample: H1GoldChaseCalibrationSample): string | null {
  if (completeSampleBlockers(sample).length > 0) return null;
  return sha256(`${sample.snapshotId}|${sample.decisionId}|${sample.candidateKey}|${sample.t0ObservedAtMs}`);
}

export function deriveH1GoldChaseCalibrationPayloadDigest(sample: H1GoldChaseCalibrationSample): string | null {
  if (completeSampleBlockers(sample).length > 0) return null;
  return sha256(canonicalJson(sample));
}

function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

async function getPool(): Promise<InstanceType<typeof Pool> | null> {
  const url = databaseUrl();
  if (!url) return null;
  if (pool && initializedForUrl === url) return pool;
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
    initializedForUrl = null;
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const candidate = new Pool({ connectionString: url, max: 2, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
  try {
    await candidate.query(`
      CREATE TABLE IF NOT EXISTS ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1} (
        sample_key TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        t0_observed_at_ms BIGINT NOT NULL,
        payload_digest TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_h1_gold_chase_calibration_created_v1
        ON ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1} (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_h1_gold_chase_calibration_identity_v1
        ON ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1} (snapshot_id, decision_id, candidate_key, t0_observed_at_ms);
    `);
    pool = candidate;
    initializedForUrl = url;
    return pool;
  } catch {
    await candidate.end().catch(() => undefined);
    return null;
  }
}

function validPersistedRow(row: PersistedRow | null | undefined): row is PersistedRow {
  if (!row?.sample_key?.trim() || !row.payload_digest?.trim()) return false;
  const sample = row.payload;
  if (completeSampleBlockers(sample).length > 0) return false;
  const expectedKey = deriveH1GoldChaseCalibrationSampleKey(sample);
  const expectedDigest = deriveH1GoldChaseCalibrationPayloadDigest(sample);
  return expectedKey === row.sample_key &&
    expectedDigest === row.payload_digest &&
    row.snapshot_id === sample.snapshotId &&
    row.decision_id === sample.decisionId &&
    row.candidate_key === sample.candidateKey &&
    Number(row.t0_observed_at_ms) === sample.t0ObservedAtMs;
}

/**
 * Research-only immutable durable persistence.
 *
 * This function rebuilds the sample from raw T0 + immutable forward journal on
 * every call. It never accepts a free pre-labelled chase verdict.
 *
 * The database primary key makes concurrent same-identity writes deterministic:
 * the first complete payload wins. An exact retry is idempotent; any later
 * divergent payload with the same immutable identity returns CONFLICT and is
 * never allowed to overwrite the stored row.
 */
export async function persistH1GoldChaseCalibrationSample(
  observationInput: H1GoldChaseObservationInput,
  journal: BusinessForwardJournalRecord | null | undefined,
): Promise<H1GoldChasePersistenceResult> {
  const sample = buildH1GoldChaseCalibrationSample(observationInput, journal);
  const sampleBlockers = completeSampleBlockers(sample);
  if (sampleBlockers.length > 0) {
    return result("NOT_COMPLETE", sample, null, null, [...sample.blockers, ...sampleBlockers]);
  }

  const sampleKey = deriveH1GoldChaseCalibrationSampleKey(sample)!;
  const payloadDigest = deriveH1GoldChaseCalibrationPayloadDigest(sample)!;
  const p = await getPool();
  if (!p) return result("DB_UNAVAILABLE", sample, sampleKey, payloadDigest, ["DURABLE_POSTGRES_REQUIRED"]);

  try {
    const insertResult = await p.query<{ sample_key: string }>(
      `INSERT INTO ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1}
        (sample_key, snapshot_id, decision_id, candidate_key, t0_observed_at_ms, payload_digest, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (sample_key) DO NOTHING
       RETURNING sample_key`,
      [sampleKey, sample.snapshotId, sample.decisionId, sample.candidateKey, sample.t0ObservedAtMs, payloadDigest, JSON.stringify(sample)],
    );
    const insertedNow = (insertResult.rowCount ?? 0) === 1;

    const readback = await p.query<PersistedRow>(
      `SELECT sample_key, snapshot_id, decision_id, candidate_key, t0_observed_at_ms, payload_digest, payload, created_at
       FROM ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1}
       WHERE sample_key = $1`,
      [sampleKey],
    );
    const stored = readback.rows[0];
    if (!validPersistedRow(stored)) return result("DB_ERROR", sample, sampleKey, payloadDigest, ["EXACT_DURABLE_READBACK_VALIDATION_FAILED"]);
    if (stored.payload_digest !== payloadDigest || canonicalJson(stored.payload) !== canonicalJson(sample)) {
      return result("CONFLICT", sample, sampleKey, payloadDigest, ["DIVERGENT_DUPLICATE_IMMUTABLE_IDENTITY"]);
    }

    return result(insertedNow ? "PERSISTED" : "EXACT_DUPLICATE", stored.payload, sampleKey, payloadDigest);
  } catch {
    return result("DB_ERROR", sample, sampleKey, payloadDigest, ["DURABLE_PERSISTENCE_QUERY_FAILED"]);
  }
}

export async function loadH1GoldChaseCalibrationSample(sampleKey: string): Promise<H1GoldChaseCalibrationSample | null> {
  if (!/^[a-f0-9]{64}$/.test(sampleKey)) return null;
  const p = await getPool();
  if (!p) return null;
  try {
    const readback = await p.query<PersistedRow>(
      `SELECT sample_key, snapshot_id, decision_id, candidate_key, t0_observed_at_ms, payload_digest, payload, created_at
       FROM ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1}
       WHERE sample_key = $1`,
      [sampleKey],
    );
    const row = readback.rows[0];
    return validPersistedRow(row) ? row.payload : null;
  } catch {
    return null;
  }
}

export async function loadRecentH1GoldChaseCalibrationSamples(limit = 100): Promise<H1GoldChaseCalibrationSample[]> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) return [];
  const p = await getPool();
  if (!p) return [];
  try {
    const readback = await p.query<PersistedRow>(
      `SELECT sample_key, snapshot_id, decision_id, candidate_key, t0_observed_at_ms, payload_digest, payload, created_at
       FROM ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1}
       ORDER BY created_at ASC, sample_key ASC
       LIMIT $1`,
      [limit],
    );
    return readback.rows.filter(validPersistedRow).map((row) => row.payload);
  } catch {
    return [];
  }
}

/** Test/process-lifecycle hook: closes this isolated research-only pool. */
export async function closeH1GoldChaseCalibrationPersistence(): Promise<void> {
  const current = pool;
  pool = null;
  initializedForUrl = null;
  if (current) await current.end().catch(() => undefined);
}
