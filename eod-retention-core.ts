export const DEFAULT_EOD_RETENTION_DAYS = 60;
export const MIN_EOD_RETENTION_DAYS = 30;
export const MAX_EOD_RETENTION_DAYS = 365;

export function resolveRetentionDays(raw?: string): number {
  if (!raw?.trim()) return DEFAULT_EOD_RETENTION_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_EOD_RETENTION_DAYS || value > MAX_EOD_RETENTION_DAYS) {
    throw new Error(`EOD_RETENTION_DAYS_INVALID:${raw}`);
  }
  return value;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function retentionCutoffDate(today: string, retentionDays: number): string {
  if (!isIsoDate(today)) throw new Error("EOD_RETENTION_TODAY_INVALID");
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_EOD_RETENTION_DAYS || retentionDays > MAX_EOD_RETENTION_DAYS) {
    throw new Error(`EOD_RETENTION_DAYS_INVALID:${retentionDays}`);
  }
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (retentionDays - 1));
  return d.toISOString().slice(0, 10);
}

export function indiaDateFromIso(nowIso: string): string {
  const d = new Date(nowIso);
  if (!Number.isFinite(d.getTime())) throw new Error("EOD_RETENTION_NOW_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveRetentionMode(env: NodeJS.ProcessEnv = process.env): "DRY_RUN" | "APPLY" {
  return env.EOD_RETENTION_APPLY?.trim().toLowerCase() === "true" ? "APPLY" : "DRY_RUN";
}
