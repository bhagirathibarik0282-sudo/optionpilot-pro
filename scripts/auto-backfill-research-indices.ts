import {
  getResearchIndexReadiness,
  loadHistoricalResearchIndexRange,
  rebuildResearchIndexMetrics,
} from "../research-index-runtime.js";

const DEFAULT_LOOKBACK_CALENDAR_DAYS = 430;
const DEFAULT_CHUNK_CALENDAR_DAYS = 180;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function main(): Promise<void> {
  const lookbackDays = intEnv("RESEARCH_AUTO_BACKFILL_DAYS", DEFAULT_LOOKBACK_CALENDAR_DAYS, 380, 900);
  const chunkDays = intEnv("RESEARCH_AUTO_BACKFILL_CHUNK_DAYS", DEFAULT_CHUNK_CALENDAR_DAYS, 60, 360);

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = addDays(end, -lookbackDays);
  const audits = [];

  console.log(JSON.stringify({
    ok: true,
    mode: "RESEARCH_AUTO_BACKFILL",
    productionImpact: "NONE",
    source: "NIFTY_INDICES_OFFICIAL_DAILY_SNAPSHOT",
    from: isoDate(start),
    to: isoDate(end),
    chunkCalendarDays: chunkDays,
  }));

  for (let cursor = new Date(start); cursor <= end; ) {
    const chunkEnd = new Date(Math.min(addDays(cursor, chunkDays - 1).getTime(), end.getTime()));
    const from = isoDate(cursor);
    const to = isoDate(chunkEnd);

    const audit = await loadHistoricalResearchIndexRange(from, to);
    if (!audit) throw new Error("RESEARCH_DB_UNAVAILABLE");
    audits.push(audit);

    console.log(JSON.stringify({
      chunk: `${from}..${to}`,
      requested: audit.totalRequested,
      valid: audit.totalValid,
      written: audit.totalWritten,
      rejected: audit.totalRejected,
      writeFailed: audit.totalWriteFailed,
    }));

    if (audit.totalWriteFailed > 0) {
      throw new Error(`BACKFILL_DB_WRITE_FAILURE:${from}:${to}:${audit.totalWriteFailed}`);
    }

    cursor = addDays(chunkEnd, 1);
  }

  const metricWrites = await rebuildResearchIndexMetrics();
  const readiness = await getResearchIndexReadiness();

  const summary = {
    ok: readiness.ready,
    mode: "RESEARCH_AUTO_BACKFILL",
    productionImpact: "NONE",
    from: isoDate(start),
    to: isoDate(end),
    chunks: audits.length,
    totalRequested: audits.reduce((n, x) => n + x.totalRequested, 0),
    totalWritten: audits.reduce((n, x) => n + x.totalWritten, 0),
    totalRejected: audits.reduce((n, x) => n + x.totalRejected, 0),
    totalWriteFailed: audits.reduce((n, x) => n + x.totalWriteFailed, 0),
    metricWrites,
    readiness,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!readiness.ready) process.exitCode = 4;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    mode: "RESEARCH_AUTO_BACKFILL",
    productionImpact: "NONE",
    reason: "AUTO_BACKFILL_FAILED",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
