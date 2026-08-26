import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { sourceTruthRevisionResolverSchemaSql, type RevisionReviewState } from "./source-truth-revision-resolver.js";

export type RevisionReviewAction = "APPROVE" | "REJECT" | "SUPERSEDE";

export interface RevisionReviewRequest {
  revisionId: string;
  action: RevisionReviewAction;
  note?: string | null;
}

type RevisionTargetRow = {
  id: number;
  revision_id: string;
  supersedes_observation_id: string;
  review_state: RevisionReviewState;
};

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reviewEventId(input: { revisionId: string; action: RevisionReviewAction; reviewer: string; note?: string | null }): string {
  return createHash("sha256").update(canonical({
    revisionId: input.revisionId,
    action: input.action,
    reviewer: input.reviewer,
    note: input.note ?? null,
  })).digest("hex");
}

export function revisionReviewSchemaSql(): string {
  return `
    ${sourceTruthRevisionResolverSchemaSql()}
    CREATE TABLE IF NOT EXISTS source_truth_revision_review_log (
      event_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_source_truth_review_log_revision
      ON source_truth_revision_review_log (revision_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_truth_review_log_observation
      ON source_truth_revision_review_log (observation_id, created_at DESC);
  `;
}

export function validateRevisionReviewRequest(body: unknown): { ok: true; value: RevisionReviewRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "INVALID_REVIEW_BODY" };
  const b = body as Record<string, unknown>;
  const revisionId = typeof b.revisionId === "string" ? b.revisionId.trim() : "";
  const action = typeof b.action === "string" ? b.action.trim().toUpperCase() : "";
  const note = typeof b.note === "string" ? b.note.trim() : null;
  if (!/^[a-f0-9]{64}$/i.test(revisionId)) return { ok: false, reason: "INVALID_REVISION_ID" };
  if (!["APPROVE","REJECT","SUPERSEDE"].includes(action)) return { ok: false, reason: "INVALID_REVIEW_ACTION" };
  if (note && note.length > 1000) return { ok: false, reason: "REVIEW_NOTE_TOO_LARGE" };
  return { ok: true, value: { revisionId, action: action as RevisionReviewAction, note } };
}

export function allowedReviewTransition(from: RevisionReviewState, action: RevisionReviewAction): RevisionReviewState | null {
  if (from === "UNREVIEWED" && action === "APPROVE") return "APPROVED";
  if (from === "UNREVIEWED" && action === "REJECT") return "REJECTED";
  if (from === "APPROVED" && action === "SUPERSEDE") return "SUPERSEDED";
  return null;
}

export async function applyRevisionReview(request: RevisionReviewRequest, reviewer: string): Promise<
  | { ok: true; revisionId: string; fromState: RevisionReviewState; toState: RevisionReviewState; supersededRevisionIds: string[]; insertedEvent: boolean }
  | { ok: false; reason: string }
> {
  if (!dbIsConfigured()) return { ok: false, reason: "DB_NOT_CONFIGURED" };
  if (!(await dbQuerySafe(revisionReviewSchemaSql()))) return { ok: false, reason: "REVIEW_SCHEMA_UNAVAILABLE" };

  const target = await dbQuerySafe<RevisionTargetRow>(`
    SELECT id, revision_id, supersedes_observation_id, review_state
    FROM source_truth_revision_log
    WHERE revision_id = $1
    LIMIT 1
  `, [request.revisionId]);
  if (!target) return { ok: false, reason: "DB_QUERY_FAILED" };
  if (!target.rows.length) return { ok: false, reason: "REVISION_NOT_FOUND" };

  const row = target.rows[0];
  const toState = allowedReviewTransition(row.review_state, request.action);
  if (!toState) return { ok: false, reason: "ILLEGAL_REVIEW_TRANSITION" };
  const eventId = reviewEventId({ revisionId: request.revisionId, action: request.action, reviewer, note: request.note });

  if (request.action === "APPROVE") {
    const result = await dbQuerySafe<{ revision_id: string; previous_approved: string[] | null }>(`
      WITH previous AS (
        UPDATE source_truth_revision_log
        SET review_state = 'SUPERSEDED', reviewed_by = $2, reviewed_at = now(), review_note = 'AUTO_SUPERSEDED_BY_NEW_APPROVAL'
        WHERE supersedes_observation_id = $3
          AND revision_id <> $1
          AND review_state = 'APPROVED'
        RETURNING revision_id
      ), target AS (
        UPDATE source_truth_revision_log
        SET review_state = 'APPROVED', reviewed_by = $2, reviewed_at = now(), review_note = $4
        WHERE revision_id = $1 AND review_state = 'UNREVIEWED'
        RETURNING revision_id
      ), event AS (
        INSERT INTO source_truth_revision_review_log (
          event_id, revision_id, observation_id, from_state, to_state, action, reviewer, note
        )
        SELECT $5, $1, $3, 'UNREVIEWED', 'APPROVED', 'APPROVE', $2, $4
        FROM target
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      )
      SELECT t.revision_id,
             COALESCE((SELECT json_agg(p.revision_id) FROM previous p), '[]'::json) AS previous_approved
      FROM target t
    `, [request.revisionId, reviewer, row.supersedes_observation_id, request.note ?? null, eventId]);
    if (!result) return { ok: false, reason: "REVIEW_WRITE_FAILED" };
    if (!result.rows.length) return { ok: false, reason: "REVIEW_STATE_CHANGED_CONCURRENTLY" };
    const previous = Array.isArray(result.rows[0].previous_approved) ? result.rows[0].previous_approved : [];
    return { ok: true, revisionId: request.revisionId, fromState: "UNREVIEWED", toState: "APPROVED", supersededRevisionIds: previous, insertedEvent: true };
  }

  const result = await dbQuerySafe<{ revision_id: string }>(`
    WITH target AS (
      UPDATE source_truth_revision_log
      SET review_state = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      WHERE revision_id = $1 AND review_state = $5
      RETURNING revision_id, supersedes_observation_id
    ), event AS (
      INSERT INTO source_truth_revision_review_log (
        event_id, revision_id, observation_id, from_state, to_state, action, reviewer, note
      )
      SELECT $6, $1, supersedes_observation_id, $5, $2, $7, $3, $4
      FROM target
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    )
    SELECT revision_id FROM target
  `, [request.revisionId, toState, reviewer, request.note ?? null, row.review_state, eventId, request.action]);
  if (!result) return { ok: false, reason: "REVIEW_WRITE_FAILED" };
  if (!result.rows.length) return { ok: false, reason: "REVIEW_STATE_CHANGED_CONCURRENTLY" };
  return { ok: true, revisionId: request.revisionId, fromState: row.review_state, toState, supersededRevisionIds: [], insertedEvent: true };
}

function authorizeReview(c: any) {
  const configured = process.env.SOURCE_TRUTH_REVIEW_TOKEN?.trim();
  if (!configured) return c.json({ ok: false, reason: "SOURCE_TRUTH_REVIEW_DISABLED", productionImpact: "NONE" }, 503);
  const supplied = c.req.header("x-source-truth-review-token")?.trim();
  if (!supplied || supplied !== configured) return c.json({ ok: false, reason: "SOURCE_TRUTH_REVIEW_FORBIDDEN", productionImpact: "NONE" }, 403);
  return null;
}

function reviewerLabel(c: any): string {
  const supplied = c.req.header("x-source-truth-reviewer")?.trim();
  return supplied && /^[A-Za-z0-9_.:@-]{3,80}$/.test(supplied) ? supplied : "SOURCE_TRUTH_REVIEW_TOKEN";
}

export function mountSourceTruthRevisionReviewRoutes(app: Hono): void {
  app.post("/api/source-truth/revisions/review", async (c) => {
    const denied = authorizeReview(c);
    if (denied) return denied;
    const parsed = validateRevisionReviewRequest(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ ok: false, reason: parsed.reason, productionImpact: "NONE" }, 400);
    const result = await applyRevisionReview(parsed.value, reviewerLabel(c));
    if (!result.ok) {
      const status = result.reason === "REVISION_NOT_FOUND" ? 404 : result.reason === "ILLEGAL_REVIEW_TRANSITION" ? 409 : 503;
      return c.json({ ...result, productionImpact: "NONE" }, status);
    }
    return c.json({
      ...result,
      reviewAuditAppendOnly: true,
      knownThenObservationMutated: false,
      autoAppliedToLiveEvidence: false,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      apiVersion: "SOURCE_TRUTH_REVIEW_V1",
    });
  });
}

export function revisionReviewWorkflowSafetyContract() {
  return {
    dedicatedTokenRequired: true,
    originalKnownThenImmutable: true,
    onlyOneApprovedRevisionPerObservationAfterApproval: true,
    reviewEventsAppendOnly: true,
    approvedScope: "KNOWN_LATER_ANALYTICS_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    version: "SOURCE_TRUTH_REVIEW_V1",
  } as const;
}
