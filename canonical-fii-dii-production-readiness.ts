import type { FiiDiiDailyRow } from "./canonical-fii-dii-official-context.ts";
import { buildPracticalFiiDiiContextV2 } from "./canonical-fii-dii-practical-ingest-v2.ts";
import { buildFiiDiiDashboardContextView } from "./canonical-fii-dii-dashboard-context-adapter.ts";
import { latestRecordedMarketSessionDate, withFiiDiiDb } from "./fii-dii-store.ts";

export const CANONICAL_FII_DII_PRODUCTION_READINESS_V1 = "CANONICAL_FII_DII_PRODUCTION_READINESS_V1" as const;

type StoredCashRow = {
  trade_date: string;
  source: string;
  source_url: string;
  fetched_at: string;
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
};

export function assertFiiDiiSessionNotBehindMarketSession(officialDate: string, marketSessionDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(officialDate) || !/^\d{4}-\d{2}-\d{2}$/.test(marketSessionDate)) {
    throw new Error("FII_DII_FRESHNESS_DATE_INVALID");
  }
  if (officialDate < marketSessionDate) {
    throw new Error(`FII_DII_OFFICIAL_SESSION_BEHIND_MARKET:${officialDate}<${marketSessionDate}`);
  }
}

function mapStoredHistory(rows: StoredCashRow[]): { history: FiiDiiDailyRow[]; blockers: string[] } {
  const blockers: string[] = [];
  const history: FiiDiiDailyRow[] = [];
  for (const row of rows) {
    if (row.source !== "NSE_FII_DII" || !/^https:\/\/www\.nseindia\.com\/api\/fiidiiTrade(?:Nse|React)$/.test(row.source_url)) {
      blockers.push(`FII_DII_DB_SOURCE_INVALID:${row.trade_date}`);
      continue;
    }
    const values = [row.fii_buy,row.fii_sell,row.fii_net,row.dii_buy,row.dii_sell,row.dii_net].map(Number);
    if (values.some((v) => !Number.isFinite(v))) {
      blockers.push(`FII_DII_DB_VALUE_INVALID:${row.trade_date}`);
      continue;
    }
    history.push(
      { date: row.trade_date, category: "FII_FPI", buyCrore: values[0], sellCrore: values[1], netCrore: values[2] },
      { date: row.trade_date, category: "DII", buyCrore: values[3], sellCrore: values[4], netCrore: values[5] },
    );
  }
  return { history, blockers: [...new Set(blockers)] };
}

export function evaluateFiiDiiProductionReadiness(input: {
  expectedMarketSessionDate: string;
  storedRows: StoredCashRow[];
}) {
  const mapped = mapStoredHistory(input.storedRows);
  const latestStoredSessionDate = input.storedRows.at(-1)?.trade_date ?? null;
  const blockers = [...mapped.blockers];
  if (!latestStoredSessionDate) blockers.push("FII_DII_DB_HISTORY_EMPTY");
  if (latestStoredSessionDate) {
    try {
      assertFiiDiiSessionNotBehindMarketSession(latestStoredSessionDate, input.expectedMarketSessionDate);
    } catch (err) {
      blockers.push(err instanceof Error ? err.message : "FII_DII_FRESHNESS_CHECK_FAILED");
    }
  }

  const practical = latestStoredSessionDate
    ? buildPracticalFiiDiiContextV2({ history: mapped.history, asOfDate: latestStoredSessionDate, maxStaleCalendarDays: 0 })
    : null;
  if (practical && practical.blockers.length) blockers.push(...practical.blockers);
  const view = practical ? buildFiiDiiDashboardContextView(practical) : null;
  if (view && !view.ready) blockers.push(...view.blockers);

  const ready = blockers.length === 0 && Boolean(view?.ready);
  return {
    version: CANONICAL_FII_DII_PRODUCTION_READINESS_V1,
    ready,
    expectedMarketSessionDate: input.expectedMarketSessionDate,
    latestStoredSessionDate,
    storedSessionCount: input.storedRows.length,
    freshAgainstLatestRecordedMarketSession: Boolean(latestStoredSessionDate && latestStoredSessionDate >= input.expectedMarketSessionDate),
    windows: view?.windows ?? [],
    warnings: view?.warnings ?? [],
    blockers: [...new Set(blockers)],
    source: "OFFICIAL_NSE" as const,
    sourceMode: "PRODUCTION_DB_READBACK" as const,
    semantics: "PREVIOUS_SESSION_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const,
    readOnly: true as const,
    contextOnly: true as const,
    grantsDirectionalSupport: false as const,
    affectsVerdict: false as const,
    affectsCandidate: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    mutatesData: false as const,
    failClosed: true as const,
  };
}

export async function getFiiDiiProductionReadiness() {
  return withFiiDiiDb(async (pool) => {
    const expectedMarketSessionDate = await latestRecordedMarketSessionDate(pool);
    const result = await pool.query<StoredCashRow>(`
      SELECT trade_date::text, source, source_url, fetched_at::text,
             fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
      FROM fii_dii_cash_daily
      ORDER BY trade_date DESC
      LIMIT 20
    `);
    const storedRows = [...result.rows].reverse();
    return evaluateFiiDiiProductionReadiness({ expectedMarketSessionDate, storedRows });
  });
}
