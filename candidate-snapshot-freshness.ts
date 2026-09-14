export interface CandidateSnapshotFreshnessInput {
  hasSnapshot: boolean;
  snapshotTimeMs: number | null | undefined;
  nowMs: number;
  ttlMs: number;
}

/**
 * Candidate-facing endpoints must never treat a response-generation time as
 * proof that their underlying market snapshot is current.
 */
export function shouldRefreshCandidateSnapshot(input: CandidateSnapshotFreshnessInput): boolean {
  if (!input.hasSnapshot) return true;
  if (!Number.isFinite(input.snapshotTimeMs) || (input.snapshotTimeMs ?? 0) <= 0) return true;
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0) return true;

  const ageMs = input.nowMs - input.snapshotTimeMs!;
  return ageMs < 0 || ageMs >= input.ttlMs;
}
