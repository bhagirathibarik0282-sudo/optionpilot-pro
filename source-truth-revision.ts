import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { ensureSourceTruthSchema } from "./source-truth-db.js";

export type SourceTruthCorrectionClass =
  | "METADATA"
  | "TIMESTAMP"
  | "IDENTITY"
  | "QUALITY"
  | "CALCULATION"
  | "OTHER";

export interface SourceTruthRevisionRequest {
  supersedesObservationId: string;
  reasonCode: string;
  correctionClass: SourceTruthCorrectionClass;
  correctedPayload: Record<string, unknown>;
  note?: string | null;
}

export interface SourceTruthOriginalRow {
  observation_id: string;
  record_kind: string;
  symbol: string;
  minute_bucket: string | Date;
  expiry: string | Date | null;
  strike: number | null;
  option_type: string | null;
  source_provider: string;
  source_timestamp: string | Date | null;
  received_at: string | Date;
  computed_at: string | Date | null;
  data_age_ms: number | string | null;
  freshness_state: string;
  identity_state: string;
  quality_state: string;
  usability: string;
  reason_codes: unknown;
  identity: unknown;
  source_version: string | null;
  calculation_version: string | null;
  created_at: string | Date;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceTruthPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function sourceTruthRevisionId(input: Pick<SourceTruthRevisionRequest, "supersedesObservationId" | "reasonCode" | "correctionClass" | "correctedPayload">): string {
  return createHash("sha256").update(canonical({
    supersedesObservationId: input.supersedesObservationId,
    reasonCode: input.reasonCode.trim().toUpperCase(),
    correctionClass: input.correctionClass,
    correctedPayload: input.correctedPayload,
  })).digest("hex");
}

export function sourceTruthRevisionSchemaSql(): string {
  return `
    ALTER TABLE source_truth_revision_log
      ADD COLUMN IF NOT EXISTS revision_id TEXT,
      ADD COLUMN IF NOT EXISTS correction_class TEXT,
      ADD COLUMN IF NOT EXISTS actor TEXT,
      ADD COLUMN IF NOT EXISTS note TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_truth_revision_id
      ON source_truth_revision_log (revision_id)
      WHERE revision_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_source_truth_revision_supersedes
      ON source_truth_revision_log (supersedes_observation_id, created_at DESC);
  `;
}

export function validateSourceTruthRevisionRequest(body: unknown): { ok: true; value: SourceTruthRevisionRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "INVALID_REVISION_BODY" };
  const b = body as Record<string, unknown>;
  const supersedesObservationId = typeof b.supersedesObservationId === "string" ? b.supersedesObservationId.trim() : "";
  const reasonCode = typeof b.reasonCode === "string" ? b.reasonCode.trim().toUpperCase() : "";
  const correctionClass = typeof b.correctionClass === "string" ? b.correctionClass.trim().toUpperCase() : "";
  const correctedPayload = b.correctedPayload;
  const note = typeof b.note === "string" ? b.note.trim() : null;

  if (!/^[a-f0-9]{64}$/i.test(supersedesObservationId)) return { ok: false, reason: "INVALID_SUPERSEDES_OBSERVATION_ID" };
  if (!/^[A-Z0-9_:-]{3,80}$/.test(reasonCode)) return { ok: false, reason: "INVALID_REVISION_REASON_CODE" };
  if (!["METADATA","TIMESTAMP","IDENTITY","QUALITY","CALCULATION","OTHER"].includes(correctionClass)) return { ok: false, reason: "INVALID_CORRECTION_CLASS" };
  if (!correctedPayload || typeof correctedPayload !== "object" || Array.isArray(correctedPayload)) return { ok: false, reason: "INVALID_CORRECTED_PAYLOAD" };
  if (canonical(correctedPayload).length > 50_000) return { ok: false, reason: "CORRECTED_PAYLOAD_TOO_LARGE" };
  if (note && note.length > 1000) return { ok: false, reason: "REVISION_NOTE_TOO_LARGE" };

  return {
    ok: true,
    value: {
      supersedesObservationId,
      reasonCode,
      correctionClass: correctionClass as SourceTruthCorrectionClass,
      correctedPayload: correctedPayload as Record<string, unknown>,
      note,
    },
  };
}

export async function appendSourceTruthRevision(request: SourceTruthRevisionRequest, actor = "SOURCE_TRUTH_ADMIN"): Promise<
  | { ok: true; revisionId: string; oldPayloadHash: string; newPayloadHash: string; inserted: boolean }
  | { ok: false; reason: string }
> {
  if (!dbIsConfigured()) return { ok: false, reason: "DB_NOT_CONFIGURED" };
  if (!(await ensureSourceTruthSchema())) return { ok: false, reason: "SOURCE_TRUTH_SCHEMA_UNAVAILABLE" };
  if (!(await dbQuerySafe(sourceTruthRevisionSchemaSql()))) return { ok: false, reason: "REVISION_SCHEMA_UNAVAILABLE" };

  const original = await dbQuerySafe<SourceTruthOriginalRow>(`
    SELECT * FROM source_truth_observation_1m WHERE observation_id = $1 LIMIT 1
  `, [request.supersedesObservationId]);
  if (!original) return { ok: false, reason: "DB_QUERY_FAILED" };
  if (!original.rows.length) return { ok: false, reason: "SUPERSEDED_OBSERVATION_NOT_FOUND" };

  const oldPayload = original.rows[0];
  const oldPayloadHash = sourceTruthPayloadHash(oldPayload);
  const newPayloadHash = sourceTruthPayloadHash(request.correctedPayload);
  if (oldPayloadHash === newPayloadHash) return { ok: false, reason: "REVISION_HAS_NO_PAYLOAD_CHANGE" };

  const revisionId = sourceTruthRevisionId(request);
  const result = await dbQuerySafe<{ revision_id: string }>(`
    INSERT INTO source_truth_revision_log (
      revision_id, observation_id, supersedes_observation_id, reason_code,
      correction_class, actor, note, old_payload_hash, new_payload_hash, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    ON CONFLICT (revision_id) WHERE revision_id IS NOT NULL DO NOTHING
    RETURNING revision_id
  `, [
    revisionId,
    request.supersedesObservationId,
    request.supersedesObservationId,
    request.reasonCode,
    request.correctionClass,
    actor,
    request.note ?? null,
    oldPayloadHash,
    newPayloadHash,
    JSON.stringify(request.correctedPayload),
  ]);
  if (!result) return { ok: false, reason: "REVISION_WRITE_FAILED" };

  return { ok: true, revisionId, oldPayloadHash, newPayloadHash, inserted: result.rows.length > 0 };
}

function authorizeRevisionMutation(c: any) {
  const configured = process.env.SOURCE_TRUTH_REVISION_TOKEN?.trim();
  if (!configured) return c.json({ ok: false, reason: "SOURCE_TRUTH_REVISIONS_DISABLED", productionImpact: "NONE" }, 503);
  const supplied = c.req.header("x-source-truth-revision-token")?.trim();
  if (!supplied || supplied !== configured) return c.json({ ok: false, reason: "SOURCE_TRUTH_REVISION_FORBIDDEN", productionImpact: "NONE" }, 403);
  return null;
}

export function mountSourceTruthRevisionRoutes(app: Hono): void {
  app.get("/api/source-truth/revisions/:observationId", async (c) => {
    c.header("Cache-Control", "no-store");
    const observationId = c.req.param("observationId");
    if (!/^[a-f0-9]{64}$/i.test(observationId)) return c.json({ ok: false, reason: "INVALID_OBSERVATION_ID" }, 400);
    if (!dbIsConfigured()) return c.json({ ok: false, reason: "DB_NOT_CONFIGURED", revisions: [] }, 503);
    const result = await dbQuerySafe(`
      SELECT revision_id, observation_id, supersedes_observation_id, reason_code,
             correction_class, actor, note, old_payload_hash, new_payload_hash, payload, created_at
      FROM source_truth_revision_log
      WHERE supersedes_observation_id = $1
      ORDER BY created_at ASC, id ASC
    `, [observationId]);
    if (!result) return c.json({ ok: false, reason: "DB_QUERY_FAILED", revisions: [] }, 503);
    return c.json({ ok: true, observationId, revisions: result.rows, readOnly: true, affectsVerdict: false, affectsTelegram: false, affectsExecution: false });
  });

  app.post("/api/source-truth/revisions", async (c) => {
    const denied = authorizeRevisionMutation(c);
    if (denied) return denied;
    const parsed = validateSourceTruthRevisionRequest(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ ok: false, reason: parsed.reason, productionImpact: "NONE" }, 400);
    const result = await appendSourceTruthRevision(parsed.value, "SOURCE_TRUTH_REVISION_TOKEN");
    if (!result.ok) {
      const status = result.reason === "SUPERSEDED_OBSERVATION_NOT_FOUND" ? 404 : 503;
      return c.json({ ...result, productionImpact: "NONE" }, status);
    }
    return c.json({
      ...result,
      appendOnly: true,
      originalObservationMutated: false,
      autoAppliedToEvidence: false,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      apiVersion: "SOURCE_TRUTH_REVISION_V1",
    }, result.inserted ? 201 : 200);
  });
}
