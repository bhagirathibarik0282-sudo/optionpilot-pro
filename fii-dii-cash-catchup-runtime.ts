import { fetchOfficialFiiDiiLiveV3 } from "./canonical-fii-dii-live-fetch-v3.js";
import { normalizedCashFromOfficialRows } from "./canonical-fii-dii-production-row.js";
import { assertCashRepairReadback } from "./fii-dii-cash-repair-job.js";
import {
  ensureFiiDiiSchema,
  latestRecordedMarketSessionDate,
  upsertFiiDiiCashDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";
import type { NormalizedFiiDiiCash } from "./fii-dii-nse.js";

export const FII_DII_CASH_CATCHUP_RUNTIME_VERSION = "FII_DII_CASH_CATCHUP_RUNTIME_V1" as const;
export const FII_DII_EXISTING_CRON_HOUR_IST = 19 as const;
export const FII_DII_EXISTING_CRON_MINUTE_IST = 0 as const;

type CatchupStatus =
  | "UP_TO_DATE"
  | "DEFERRED_CURRENT_SESSION"
  | "SOURCE_NOT_READY"
  | "REPAIRED";

export interface FiiDiiCashCatchupResult {
  version: typeof FII_DII_CASH_CATCHUP_RUNTIME_VERSION;
  ok: boolean;
  status: CatchupStatus;
  expectedMarketSessionDate: string;
  latestStoredSessionDate: string | null;
  observedSourceDate: string | null;
  dbReadbackVerified: boolean;
  blocker: string | null;
  productionImpact: "CONTEXT_PERSISTENCE_ONLY";
  contextOnly: true;
  grantsDirectionalSupport: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  productionImpact: "CONTEXT_PERSISTENCE_ONLY" as const,
  contextOnly: true as const,
  grantsDirectionalSupport: false as const,
  affectsVerdict: false as const,
  affectsCandidate: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function indiaClock(nowIso: string): { date: string; minuteOfDay: number } {
  const d = new Date(nowIso);
  if (!Number.isFinite(d.getTime())) throw new Error("FII_DII_CASH_CATCHUP_NOW_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function shouldAttemptFiiDiiCashCatchup(input: {
  nowIso: string;
  expectedMarketSessionDate: string;
  latestStoredSessionDate: string | null;
}): boolean {
  if (input.latestStoredSessionDate && input.latestStoredSessionDate >= input.expectedMarketSessionDate) {
    return false;
  }
  const now = indiaClock(input.nowIso);
  if (input.expectedMarketSessionDate < now.date) return true;
  if (input.expectedMarketSessionDate > now.date) return false;
  return now.minuteOfDay >= FII_DII_EXISTING_CRON_HOUR_IST * 60 + FII_DII_EXISTING_CRON_MINUTE_IST;
}

type FetchResult = Awaited<ReturnType<typeof fetchOfficialFiiDiiLiveV3>>;

export async function runFiiDiiCashCatchupCore(
  input: {
    nowIso: string;
    expectedMarketSessionDate: string;
    latestStoredSessionDate: string | null;
  },
  deps: {
    fetchOfficial: (expectedMarketSessionDate: string) => Promise<FetchResult>;
    persistAndVerify: (row: NormalizedFiiDiiCash) => Promise<void>;
  },
): Promise<FiiDiiCashCatchupResult> {
  if (input.latestStoredSessionDate && input.latestStoredSessionDate >= input.expectedMarketSessionDate) {
    return {
      version: FII_DII_CASH_CATCHUP_RUNTIME_VERSION,
      ok: true,
      status: "UP_TO_DATE",
      expectedMarketSessionDate: input.expectedMarketSessionDate,
      latestStoredSessionDate: input.latestStoredSessionDate,
      observedSourceDate: input.latestStoredSessionDate,
      dbReadbackVerified: true,
      blocker: null,
      ...SAFETY,
    };
  }

  if (!shouldAttemptFiiDiiCashCatchup(input)) {
    return {
      version: FII_DII_CASH_CATCHUP_RUNTIME_VERSION,
      ok: true,
      status: "DEFERRED_CURRENT_SESSION",
      expectedMarketSessionDate: input.expectedMarketSessionDate,
      latestStoredSessionDate: input.latestStoredSessionDate,
      observedSourceDate: null,
      dbReadbackVerified: false,
      blocker: "FII_DII_CASH_CATCHUP_WAITING_FOR_EXISTING_1900_IST_WINDOW",
      ...SAFETY,
    };
  }

  const fetched = await deps.fetchOfficial(input.expectedMarketSessionDate);
  if (!fetched.ok || !fetched.sourceUrl) {
    return {
      version: FII_DII_CASH_CATCHUP_RUNTIME_VERSION,
      ok: false,
      status: "SOURCE_NOT_READY",
      expectedMarketSessionDate: input.expectedMarketSessionDate,
      latestStoredSessionDate: input.latestStoredSessionDate,
      observedSourceDate: fetched.rows?.[0]?.date ?? null,
      dbReadbackVerified: false,
      blocker: fetched.blocker ?? "FII_DII_CASH_CATCHUP_OFFICIAL_FETCH_FAILED",
      ...SAFETY,
    };
  }

  const data = normalizedCashFromOfficialRows({
    rows: fetched.rows,
    sourceUrl: fetched.sourceUrl,
  });
  if (data.date !== input.expectedMarketSessionDate) {
    return {
      version: FII_DII_CASH_CATCHUP_RUNTIME_VERSION,
      ok: false,
      status: "SOURCE_NOT_READY",
      expectedMarketSessionDate: input.expectedMarketSessionDate,
      latestStoredSessionDate: input.latestStoredSessionDate,
      observedSourceDate: data.date,
      dbReadbackVerified: false,
      blocker: `FII_DII_CASH_CATCHUP_SOURCE_DATE_MISMATCH:${data.date}:EXPECTED:${input.expectedMarketSessionDate}`,
      ...SAFETY,
    };
  }

  await deps.persistAndVerify(data);
  return {
    version: FII_DII_CASH_CATCHUP_RUNTIME_VERSION,
    ok: true,
    status: "REPAIRED",
    expectedMarketSessionDate: input.expectedMarketSessionDate,
    latestStoredSessionDate: input.expectedMarketSessionDate,
    observedSourceDate: data.date,
    dbReadbackVerified: true,
    blocker: null,
    ...SAFETY,
  };
}

export async function runFiiDiiCashCatchupRuntime(
  nowIso = new Date().toISOString(),
): Promise<FiiDiiCashCatchupResult> {
  return withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);

    const expectedMarketSessionDate = await latestRecordedMarketSessionDate(pool);
    const latest = await pool.query<{ trade_date: string | null }>(`
      SELECT MAX(trade_date)::text AS trade_date
      FROM fii_dii_cash_daily
    `);
    const latestStoredSessionDate = latest.rows[0]?.trade_date?.trim() || null;

    return runFiiDiiCashCatchupCore(
      { nowIso, expectedMarketSessionDate, latestStoredSessionDate },
      {
        fetchOfficial: (expectedDate) =>
          fetchOfficialFiiDiiLiveV3({ retryCount: 2, expectedMarketSessionDate: expectedDate }, fetch),
        persistAndVerify: async (data) => {
          await upsertFiiDiiCashDaily(pool, data);
          const verify = await pool.query<{
            trade_date: string;
            source: string;
            source_url: string;
            fii_buy: number;
            fii_sell: number;
            fii_net: number;
            dii_buy: number;
            dii_sell: number;
            dii_net: number;
          }>(`
            SELECT trade_date::text, source, source_url,
                   fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
            FROM fii_dii_cash_daily
            WHERE trade_date=$1::date
            LIMIT 1
          `, [data.date]);
          assertCashRepairReadback(verify.rows[0], data);
        },
      },
    );
  });
}
