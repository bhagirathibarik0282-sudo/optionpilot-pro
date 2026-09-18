import { pathToFileURL } from "node:url";
import { fetchOfficialFiiDiiLiveV3 } from "./canonical-fii-dii-live-fetch-v3.js";
import { normalizedCashFromOfficialRows } from "./canonical-fii-dii-production-row.js";
import {
  ensureFiiDiiSchema,
  upsertFiiDiiCashDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";

type CashReadback = {
  trade_date: string;
  source: string;
  source_url: string;
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
};

export function requireCashRepairWriteEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.FII_DII_CASH_REPAIR_WRITE_ENABLED?.trim() !== "1") {
    throw new Error("FII_DII_CASH_REPAIR_WRITE_ENABLED_REQUIRED");
  }
}

export function cashRepairTradeDate(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FII_DII_CASH_REPAIR_TRADE_DATE?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("FII_DII_CASH_REPAIR_TRADE_DATE_REQUIRED_ISO");
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error("FII_DII_CASH_REPAIR_TRADE_DATE_INVALID");
  }
  return raw;
}

export function assertCashRepairReadback(
  stored: CashReadback | undefined,
  expected: {
    date: string;
    source: string;
    sourceUrl: string;
    fii: { buy: number; sell: number; net: number };
    dii: { buy: number; sell: number; net: number };
  },
): void {
  if (!stored) throw new Error("FII_DII_CASH_REPAIR_DB_READBACK_MISSING");
  if (
    stored.trade_date !== expected.date ||
    stored.source !== expected.source ||
    stored.source_url !== expected.sourceUrl ||
    Number(stored.fii_buy) !== expected.fii.buy ||
    Number(stored.fii_sell) !== expected.fii.sell ||
    Number(stored.fii_net) !== expected.fii.net ||
    Number(stored.dii_buy) !== expected.dii.buy ||
    Number(stored.dii_sell) !== expected.dii.sell ||
    Number(stored.dii_net) !== expected.dii.net
  ) {
    throw new Error("FII_DII_CASH_REPAIR_DB_READBACK_MISMATCH");
  }
}

export async function runCashRepair(tradeDate: string) {
  const fetched = await fetchOfficialFiiDiiLiveV3({ retryCount: 2 }, fetch);
  if (!fetched.ok || !fetched.sourceUrl) {
    throw new Error(fetched.blocker ?? "FII_DII_CASH_REPAIR_OFFICIAL_FETCH_FAILED");
  }

  const data = normalizedCashFromOfficialRows({
    rows: fetched.rows,
    sourceUrl: fetched.sourceUrl,
  });
  if (data.date !== tradeDate) {
    throw new Error(`FII_DII_CASH_REPAIR_SOURCE_DATE_MISMATCH:${data.date}:EXPECTED:${tradeDate}`);
  }

  return withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);
    await upsertFiiDiiCashDaily(pool, data);

    const verify = await pool.query<CashReadback>(`
      SELECT trade_date::text, source, source_url,
             fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
      FROM fii_dii_cash_daily
      WHERE trade_date=$1::date
      LIMIT 1
    `, [tradeDate]);

    assertCashRepairReadback(verify.rows[0], data);

    return {
      tradeDate,
      source: data.source,
      sourceUrl: data.sourceUrl,
      attempts: fetched.attempts,
      dbReadbackVerified: true,
      contextOnly: true as const,
      affectsVerdict: false as const,
      affectsCandidate: false as const,
      affectsTelegram: false as const,
      affectsExecution: false as const,
    };
  });
}

async function main(): Promise<void> {
  requireCashRepairWriteEnabled();
  const tradeDate = cashRepairTradeDate();
  const result = await runCashRepair(tradeDate);
  console.log("[FII_DII_CASH_REPAIR] success", JSON.stringify(result));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[FII_DII_CASH_REPAIR] failed", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
