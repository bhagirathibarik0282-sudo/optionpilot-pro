import { createHash } from "node:crypto";
import { dbQuerySafe } from "./db.js";
import { replayWithoutMaxPain, type CounterfactualThreshold, type MaxPainCounterfactualObservation } from "./max-pain-counterfactual.js";

export const SCORE_OBSERVATION_VERSION = "KNOWN_THEN_SCORE_OBSERVATION_V1" as const;

export interface KnownThenScoreObservationInput {
  symbol: string;
  observedAt: string;
  legacyScore: number;
  maxScore: number | null;
  legacyVerdict: string | null;
  contributions: Record<string, number>;
  overrides: string[];
  legacyCandidate: string | null;
  sourcePath?: string | null;
}

export interface KnownThenScoreObservation extends KnownThenScoreObservationInput {
  observationId: string;
  knownThen: true;
  maxPainContribution: -0.5 | 0 | 0.5 | null;
  version: typeof SCORE_OBSERVATION_VERSION;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${k}:${canonical(obj[k])}`).join(",")}}`;
  }
  return String(value);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function buildKnownThenScoreObservation(input: KnownThenScoreObservationInput): KnownThenScoreObservation | null {
  if (!input.symbol || !input.observedAt || !Number.isFinite(Date.parse(input.observedAt))) return null;
  if (!finite(input.legacyScore)) return null;
  if (input.maxScore != null && !finite(input.maxScore)) return null;
  if (!input.contributions || typeof input.contributions !== "object" || Array.isArray(input.contributions)) return null;

  const cleanContributions: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.contributions)) {
    if (!finite(value)) return null;
    cleanContributions[key] = value;
  }

  const rawMp = Object.prototype.hasOwnProperty.call(cleanContributions, "max_pain")
    ? cleanContributions.max_pain
    : null;
  const maxPainContribution = rawMp === -0.5 || rawMp === 0 || rawMp === 0.5 ? rawMp : null;

  const identity = {
    symbol: input.symbol,
    observedAt: input.observedAt,
    legacyScore: input.legacyScore,
    maxScore: input.maxScore,
    legacyVerdict: input.legacyVerdict,
    contributions: cleanContributions,
    overrides: input.overrides ?? [],
    legacyCandidate: input.legacyCandidate,
    sourcePath: input.sourcePath ?? null,
    version: SCORE_OBSERVATION_VERSION,
  };
  const observationId = createHash("sha256").update(canonical(identity)).digest("hex");

  return {
    ...input,
    contributions: cleanContributions,
    overrides: input.overrides ?? [],
    sourcePath: input.sourcePath ?? null,
    observationId,
    knownThen: true,
    maxPainContribution,
    version: SCORE_OBSERVATION_VERSION,
  };
}

export function knownThenScoreSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS score_observation_known_then (
      observation_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      legacy_score DOUBLE PRECISION NOT NULL,
      max_score DOUBLE PRECISION,
      legacy_verdict TEXT,
      contributions JSONB NOT NULL,
      overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
      legacy_candidate TEXT,
      max_pain_contribution DOUBLE PRECISION,
      source_path TEXT,
      observation_version TEXT NOT NULL,
      known_then BOOLEAN NOT NULL DEFAULT TRUE CHECK (known_then = TRUE),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_score_observation_symbol_time
      ON score_observation_known_then (symbol, observed_at DESC);
  `;
}

let schemaReady = false;
let schemaAttempt: Promise<boolean> | null = null;

export async function ensureKnownThenScoreSchema(): Promise<boolean> {
  if (schemaReady) return true;
  if (schemaAttempt) return schemaAttempt;
  schemaAttempt = (async () => {
    const r = await dbQuerySafe(knownThenScoreSchemaSql());
    schemaReady = r !== null;
    if (!schemaReady) schemaAttempt = null;
    return schemaReady;
  })();
  return schemaAttempt;
}

export function scoreObservationShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.PHASE50_SCORE_SHADOW ?? ""));
}

export async function persistKnownThenScoreObservation(input: KnownThenScoreObservationInput): Promise<string | null> {
  if (!scoreObservationShadowEnabled()) return null;
  const row = buildKnownThenScoreObservation(input);
  if (!row || !(await ensureKnownThenScoreSchema())) return null;
  const r = await dbQuerySafe<{ observation_id: string }>(`
    INSERT INTO score_observation_known_then (
      observation_id, symbol, observed_at, legacy_score, max_score, legacy_verdict,
      contributions, overrides, legacy_candidate, max_pain_contribution,
      source_path, observation_version, known_then
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,TRUE)
    ON CONFLICT (observation_id) DO NOTHING
    RETURNING observation_id
  `, [
    row.observationId, row.symbol, row.observedAt, row.legacyScore, row.maxScore,
    row.legacyVerdict, JSON.stringify(row.contributions), JSON.stringify(row.overrides),
    row.legacyCandidate, row.maxPainContribution, row.sourcePath, row.version,
  ]);
  return r?.rows?.[0]?.observation_id ?? row.observationId;
}

export async function loadKnownThenScoreObservations(symbol?: string, limit = 5000): Promise<KnownThenScoreObservation[]> {
  const bounded = Math.max(1, Math.min(20000, Math.floor(limit)));
  if (!(await ensureKnownThenScoreSchema())) return [];
  const params: unknown[] = [];
  let where = "";
  if (symbol) {
    params.push(symbol);
    where = `WHERE symbol = $${params.length}`;
  }
  params.push(bounded);
  const r = await dbQuerySafe<any>(`
    SELECT observation_id, symbol, observed_at, legacy_score, max_score, legacy_verdict,
           contributions, overrides, legacy_candidate, max_pain_contribution,
           source_path, observation_version
    FROM score_observation_known_then
    ${where}
    ORDER BY observed_at ASC
    LIMIT $${params.length}
  `, params);
  return (r?.rows ?? []).map((x: any) => ({
    observationId: String(x.observation_id),
    symbol: String(x.symbol),
    observedAt: new Date(x.observed_at).toISOString(),
    legacyScore: Number(x.legacy_score),
    maxScore: x.max_score == null ? null : Number(x.max_score),
    legacyVerdict: x.legacy_verdict ?? null,
    contributions: x.contributions ?? {},
    overrides: Array.isArray(x.overrides) ? x.overrides : [],
    legacyCandidate: x.legacy_candidate ?? null,
    maxPainContribution: x.max_pain_contribution == null ? null : Number(x.max_pain_contribution),
    sourcePath: x.source_path ?? null,
    knownThen: true as const,
    version: SCORE_OBSERVATION_VERSION,
  }));
}

export async function replayPersistedScoresWithoutMaxPain(symbol?: string, thresholds: CounterfactualThreshold[] = []) {
  const rows = await loadKnownThenScoreObservations(symbol);
  const replayRows: MaxPainCounterfactualObservation[] = rows.map((r) => ({
    observationId: r.observationId,
    knownThen: true,
    timestamp: r.observedAt,
    symbol: r.symbol,
    legacyScore: r.legacyScore,
    maxPainContribution: r.maxPainContribution,
    legacyVerdict: r.legacyVerdict,
    legacyCandidate: r.legacyCandidate,
  }));
  return replayWithoutMaxPain(replayRows, thresholds);
}

export const PHASE50_SCORE_OBSERVATION_SAFETY = Object.freeze({
  appendOnly: true,
  knownThenOnly: true,
  shadowFlagDefaultOff: true,
  noExtraBrokerCall: true,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  noHindsightReconstruction: true,
});
