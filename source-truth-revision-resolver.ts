import { dbIsConfigured, dbQuerySafe } from "./db.js";

export type RevisionReviewState = "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export type RevisionConsumptionMode = "KNOWN_THEN" | "KNOWN_LATER_ANALYTICS";

export interface ResolvedSourceTruth {
  mode: RevisionConsumptionMode;
  observationId: string;
  payload: Record<string, unknown> | null;
  revisionId: string | null;
  reviewState: RevisionReviewState | null;
  knownThenPreserved: true;
  hindsightAppliedToDecisionTime: false;
  usableForHistoricalDecisionReplay: boolean;
  usableForCorrectedAnalytics: boolean;
  reason: string;
}

type OriginalRow = Record<string, unknown> & { observation_id: string };
type RevisionRow = {
  revision_id: string | null;
  payload: unknown;
  review_state: RevisionReviewState | null;
  reviewed_at: string | Date | null;
  created_at: string | Date;
};

export function sourceTruthRevisionResolverSchemaSql(): string {
  return `
    ALTER TABLE source_truth_revision_log
      ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'UNREVIEWED',
      ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS review_note TEXT;
    CREATE INDEX IF NOT EXISTS idx_source_truth_revision_reviewed
      ON source_truth_revision_log (supersedes_observation_id, review_state, reviewed_at DESC, created_at DESC);
  `;
}

export function resolveKnownThen(observation: OriginalRow): ResolvedSourceTruth {
  return {
    mode: "KNOWN_THEN",
    observationId: observation.observation_id,
    payload: observation,
    revisionId: null,
    reviewState: null,
    knownThenPreserved: true,
    hindsightAppliedToDecisionTime: false,
    usableForHistoricalDecisionReplay: true,
    usableForCorrectedAnalytics: false,
    reason: "ORIGINAL_KNOWN_THEN_ONLY",
  };
}

export function resolveKnownLaterAnalytics(observation: OriginalRow, revisions: RevisionRow[]): ResolvedSourceTruth {
  const approved = revisions
    .filter((r) => r.review_state === "APPROVED" && r.payload && typeof r.payload === "object" && !Array.isArray(r.payload))
    .sort((a, b) => new Date(b.reviewed_at ?? b.created_at).getTime() - new Date(a.reviewed_at ?? a.created_at).getTime());
  const latest = approved[0];
  if (!latest) {
    return {
      mode: "KNOWN_LATER_ANALYTICS",
      observationId: observation.observation_id,
      payload: observation,
      revisionId: null,
      reviewState: null,
      knownThenPreserved: true,
      hindsightAppliedToDecisionTime: false,
      usableForHistoricalDecisionReplay: false,
      usableForCorrectedAnalytics: false,
      reason: "NO_APPROVED_REVISION_FALLBACK_TO_ORIGINAL",
    };
  }
  return {
    mode: "KNOWN_LATER_ANALYTICS",
    observationId: observation.observation_id,
    payload: latest.payload as Record<string, unknown>,
    revisionId: latest.revision_id,
    reviewState: "APPROVED",
    knownThenPreserved: true,
    hindsightAppliedToDecisionTime: false,
    usableForHistoricalDecisionReplay: false,
    usableForCorrectedAnalytics: true,
    reason: "LATEST_APPROVED_REVISION_FOR_ANALYTICS_ONLY",
  };
}

export async function resolveSourceTruthObservation(observationId: string, mode: RevisionConsumptionMode): Promise<ResolvedSourceTruth | null> {
  if (!dbIsConfigured()) return null;
  await dbQuerySafe(sourceTruthRevisionResolverSchemaSql());
  const original = await dbQuerySafe<OriginalRow>(`SELECT * FROM source_truth_observation_1m WHERE observation_id = $1 LIMIT 1`, [observationId]);
  if (!original?.rows.length) return null;
  if (mode === "KNOWN_THEN") return resolveKnownThen(original.rows[0]);
  const revisions = await dbQuerySafe<RevisionRow>(`
    SELECT revision_id, payload, review_state, reviewed_at, created_at
    FROM source_truth_revision_log
    WHERE supersedes_observation_id = $1
    ORDER BY COALESCE(reviewed_at, created_at) DESC, id DESC
  `, [observationId]);
  return resolveKnownLaterAnalytics(original.rows[0], revisions?.rows ?? []);
}

export function revisionReviewSafetyContract() {
  return {
    knownThenNeverRewritten: true,
    approvedRevisionScope: "FUTURE_ANALYTICS_AND_RESEARCH_ONLY",
    historicalDecisionReplayUses: "KNOWN_THEN_ONLY",
    affectsLiveVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    resolverVersion: "HINDSIGHT_SAFE_REVISION_RESOLVER_V1",
  } as const;
}
