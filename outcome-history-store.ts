import { dbQuerySafe } from "./db.js";
import type { OutcomeRecord } from "./outcome-engine.js";

export const OUTCOME_HISTORY_KIND = "OUTCOME_RECORD_V1" as const;
export const OUTCOME_HISTORY_MAX_RECORDS = 500;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOutcomeRecord(value: unknown): value is OutcomeRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OutcomeRecord>;
  return (
    typeof row.outcomeId === "string" && row.outcomeId.length > 0 &&
    typeof row.recordedAt === "string" && row.recordedAt.length > 0 &&
    isFiniteNumber(row.recordedAtMs) &&
    typeof row.tradingDate === "string" && row.tradingDate.length === 10 &&
    typeof row.symbol === "string" &&
    typeof row.status === "string" &&
    isFiniteNumber(row.windowEndsAtMs)
  );
}

/**
 * app_state_log is append-only, so one outcome may appear more than once as
 * it moves from PENDING to a terminal status. Keep the latest persisted copy
 * of each outcomeId, then restore deterministic recorded-time order.
 */
export function mergeOutcomeHistory(
  rows: readonly OutcomeRecord[],
  maxRecords = OUTCOME_HISTORY_MAX_RECORDS,
): OutcomeRecord[] {
  const cap = Math.max(1, Math.floor(maxRecords));
  const latestById = new Map<string, OutcomeRecord>();
  for (const row of rows) {
    if (!isOutcomeRecord(row)) continue;
    latestById.set(row.outcomeId, row);
  }
  return [...latestById.values()]
    .sort((a, b) => a.recordedAtMs - b.recordedAtMs || a.outcomeId.localeCompare(b.outcomeId))
    .slice(-cap);
}

export function outcomePersistenceFingerprint(record: OutcomeRecord): string {
  return JSON.stringify({
    outcomeId: record.outcomeId,
    status: record.status,
    evaluatedAt: record.evaluatedAt,
    outcomeDetail: record.outcomeDetail,
    maePremium: record.maePremium,
    mfePremium: record.mfePremium,
    maeR: record.maeR,
    mfeR: record.mfeR,
  });
}

/**
 * Checked append: unlike the legacy fire-and-forget dbInsert helper, this
 * function must surface a failed DB write so the runtime wiring does not mark
 * the fingerprint as persisted and silently suppress retries.
 */
export async function persistOutcomeRecord(record: OutcomeRecord): Promise<void> {
  const result = await dbQuerySafe(
    "INSERT INTO app_state_log (kind, payload) VALUES ($1, $2::jsonb) RETURNING id",
    [OUTCOME_HISTORY_KIND, JSON.stringify(record)],
  );
  if (!result) throw new Error("OUTCOME_HISTORY_PERSIST_FAILED");
}

export async function restoreOutcomeRecords(
  maxRecords = OUTCOME_HISTORY_MAX_RECORDS,
): Promise<OutcomeRecord[]> {
  // Read extra append-only versions so terminal updates do not crowd out
  // unique older outcomes. Invalid legacy/partial payloads are ignored.
  const cap = Math.max(1, Math.floor(maxRecords));
  const result = await dbQuerySafe<{ payload: OutcomeRecord }>(
    "SELECT payload FROM app_state_log WHERE kind = $1 ORDER BY created_at DESC LIMIT $2",
    [OUTCOME_HISTORY_KIND, cap * 10],
  );
  if (!result) throw new Error("OUTCOME_HISTORY_RESTORE_FAILED");
  const raw = result.rows.map((row) => row.payload).reverse();
  return mergeOutcomeHistory(raw, cap);
}
