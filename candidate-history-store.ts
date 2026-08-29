import { dbQuerySafe } from "./db.js";
import type { CandidateHistoryRecord } from "./candidate-history-record.js";

export interface CandidateHistoryPersistResult {
  ok: boolean;
  inserted: boolean;
  reason?: string;
}

/**
 * Historical-research-only persistence.
 * candidate_id is treated as the idempotency key even though the legacy table
 * does not yet have a UNIQUE constraint. INSERT ... WHERE NOT EXISTS prevents
 * normal duplicate writes without changing DB schema or live behavior.
 */
export async function persistCandidateHistoryRecord(
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
