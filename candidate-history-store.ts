import { dbQuerySafe } from "./db.js";
import type { CandidateHistoryRecord } from "./candidate-history-record.js";

export interface CandidateHistoryPersistResult {
  ok: boolean;
  inserted: boolean;
  reason?: string;
}

// One Railway process is the intended writer. Coalesce concurrent attempts for
// the same candidateId so two async call-sites in that process cannot race the
// legacy table's application-level NOT EXISTS guard. The entry is always
// cleared after settlement, so a failed DB write remains retryable.
const inFlightByCandidateId = new Map<string, Promise<CandidateHistoryPersistResult>>();

async function persistCandidateHistoryRecordOnce(
  row: CandidateHistoryRecord,
): Promise<CandidateHistoryPersistResult> {
  const result = await dbQuerySafe<{ inserted: boolean }>(`
    WITH ins AS (
      INSERT INTO candidate_history (
        candidate_id, symbol, observed_at, side, expiry, strike, dte, ltp, iv,
        delta, gamma, vega, theta, intrinsic, extrinsic, spread, volume, oi,
        grade, status, reason_code, selection_version
      )
      SELECT
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      WHERE NOT EXISTS (
        SELECT 1 FROM candidate_history WHERE candidate_id = $1
      )
      RETURNING true AS inserted
    )
    SELECT COALESCE((SELECT inserted FROM ins LIMIT 1), false) AS inserted
  `, [
    row.candidateId,
    row.symbol,
    row.observedAt,
    row.side,
    row.expiry,
    row.strike,
    row.dte,
    row.ltp,
    row.iv,
    row.delta,
    row.gamma,
    row.vega,
    row.theta,
    row.intrinsic,
    row.extrinsic,
    row.spread,
    row.volume,
    row.oi,
    row.grade,
    row.status,
    row.reasonCode,
    row.selectionVersion,
  ]);

  if (!result) return { ok: false, inserted: false, reason: "DB_WRITE_FAILED" };
  return { ok: true, inserted: result.rows[0]?.inserted === true };
}

/**
 * Historical-research-only persistence.
 *
 * candidate_id is the application-level identity. The current legacy schema
 * has no UNIQUE(candidate_id), so this helper combines a DB NOT EXISTS guard
 * with per-process in-flight coalescing. That is deterministic for the
 * intended single Railway writer and avoids changing production schema here.
 * A future multi-replica writer must add a DB-level uniqueness migration first.
 */
export async function persistCandidateHistoryRecord(
  row: CandidateHistoryRecord,
): Promise<CandidateHistoryPersistResult> {
  const existing = inFlightByCandidateId.get(row.candidateId);
  if (existing) return existing;

  const pending = persistCandidateHistoryRecordOnce(row);
  inFlightByCandidateId.set(row.candidateId, pending);
  try {
    return await pending;
  } finally {
    if (inFlightByCandidateId.get(row.candidateId) === pending) {
      inFlightByCandidateId.delete(row.candidateId);
    }
  }
}
