export type EodArchiveStatus = "STARTED" | "COMPLETED" | "FAILED" | "SKIPPED_NO_DATA" | "ALREADY_COMPLETED";

export interface EodArchiveDecisionInput {
  tradingDate: string;
  nowIso: string;
  alreadyCompleted: boolean;
  sourceRecordCount: number;
}

export interface EodArchiveDecision {
  shouldRun: boolean;
  status: EodArchiveStatus;
  reason: string;
}

export function isIsoTradingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function indiaTradingDateFromIso(nowIso: string): string {
  const d = new Date(nowIso);
  if (!Number.isFinite(d.getTime())) throw new Error("INVALID_NOW_ISO");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isWeekdayTradingCandidate(tradingDate: string): boolean {
  if (!isIsoTradingDate(tradingDate)) return false;
  const dow = new Date(`${tradingDate}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

export function decideEodArchive(input: EodArchiveDecisionInput): EodArchiveDecision {
  if (!isIsoTradingDate(input.tradingDate)) {
    return { shouldRun: false, status: "SKIPPED_NO_DATA", reason: "INVALID_TRADING_DATE" };
  }
  if (input.alreadyCompleted) {
    return { shouldRun: false, status: "ALREADY_COMPLETED", reason: "IDEMPOTENT_DUPLICATE_GUARD" };
  }
  if (!Number.isFinite(input.sourceRecordCount) || input.sourceRecordCount <= 0) {
    return { shouldRun: false, status: "SKIPPED_NO_DATA", reason: "NO_SOURCE_RECORDS" };
  }
  return { shouldRun: true, status: "STARTED", reason: "READY" };
}

export function archiveKey(tradingDate: string): string {
  if (!isIsoTradingDate(tradingDate)) throw new Error("INVALID_TRADING_DATE");
  return `EOD:${tradingDate}`;
}
