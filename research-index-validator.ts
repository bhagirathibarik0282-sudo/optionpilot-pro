import type {
  ResearchIndexDailyRecord,
  ValidationResult,
} from "./research-index-types";

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validateResearchIndexRecord(
  record: ResearchIndexDailyRecord,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isIsoDate(record.tradeDate)) errors.push("INVALID_TRADE_DATE");
  if (!record.indexCode) errors.push("MISSING_INDEX_CODE");
  if (!record.indexName?.trim()) errors.push("MISSING_INDEX_NAME");
  if (!record.source?.trim()) errors.push("MISSING_SOURCE");

  const ohlc = [record.open, record.high, record.low, record.close];
  if (!ohlc.every(isFinitePositive)) errors.push("INVALID_OHLC_VALUE");

  if (Number.isFinite(record.high) && Number.isFinite(record.low) && record.high < record.low) {
    errors.push("HIGH_BELOW_LOW");
  }
  if (Number.isFinite(record.high) && Number.isFinite(record.open) && record.high < record.open) {
    errors.push("HIGH_BELOW_OPEN");
  }
  if (Number.isFinite(record.high) && Number.isFinite(record.close) && record.high < record.close) {
    errors.push("HIGH_BELOW_CLOSE");
  }
  if (Number.isFinite(record.low) && Number.isFinite(record.open) && record.low > record.open) {
    errors.push("LOW_ABOVE_OPEN");
  }
  if (Number.isFinite(record.low) && Number.isFinite(record.close) && record.low > record.close) {
    errors.push("LOW_ABOVE_CLOSE");
  }

  if (record.triClose !== null && !isFinitePositive(record.triClose)) {
    errors.push("INVALID_TRI_CLOSE");
  }

  if (!record.sourceTimestamp) warnings.push("MISSING_SOURCE_TIMESTAMP");
  if (record.freshnessStatus === "STALE") warnings.push("STALE_SOURCE_RECORD");
  if (record.freshnessStatus === "UNKNOWN") warnings.push("UNKNOWN_FRESHNESS");

  const valid = errors.length === 0;
  const status: ValidationResult["status"] = valid
    ? warnings.length > 0
      ? "PARTIAL"
      : "VALID"
    : "INVALID";

  return { valid, status, warnings, errors };
}

export function validateResearchIndexBatch(
  records: ResearchIndexDailyRecord[],
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  if (records.length === 0) {
    errors.push("EMPTY_BATCH");
    return { valid: false, status: "INVALID", warnings, errors };
  }

  for (const record of records) {
    const result = validateResearchIndexRecord(record);
    warnings.push(...result.warnings.map((w) => `${record.indexCode}:${record.tradeDate}:${w}`));
    errors.push(...result.errors.map((e) => `${record.indexCode}:${record.tradeDate}:${e}`));

    const key = `${record.indexCode}:${record.tradeDate}`;
    if (seen.has(key)) errors.push(`${key}:DUPLICATE_RECORD`);
    seen.add(key);
  }

  const valid = errors.length === 0;
  const status: ValidationResult["status"] = valid
    ? warnings.length > 0
      ? "PARTIAL"
      : "VALID"
    : "INVALID";

  return { valid, status, warnings, errors };
}

export function flagExtremeCloseJump(
  previousClose: number,
  currentClose: number,
  warningThresholdPct = 15,
): string | null {
  if (!isFinitePositive(previousClose) || !isFinitePositive(currentClose)) return null;
  const changePct = Math.abs((currentClose / previousClose - 1) * 100);
  return changePct >= warningThresholdPct ? `EXTREME_CLOSE_JUMP_${changePct.toFixed(2)}PCT` : null;
}
