import { fetchOfficialFiiDiiLiveV3 } from "./canonical-fii-dii-live-fetch-v3.js";
import { normalizedCashFromOfficialRows } from "./canonical-fii-dii-production-row.js";
import {
  ensureFiiDiiSchema,
  upsertFiiDiiCashDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";

async function main(): Promise<void> {
  const result = await withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);

    const fetched = await fetchOfficialFiiDiiLiveV3({ retryCount: 2 }, fetch);
    if (!fetched.ok || !fetched.sourceUrl) {
      throw new Error(fetched.blocker ?? "FII_DII_OFFICIAL_FETCH_FAILED");
    }

    const data = normalizedCashFromOfficialRows({
      rows: fetched.rows,
      sourceUrl: fetched.sourceUrl,
    });
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

    const stored = verify.rows[0];
    if (!stored) throw new Error("FII_DII_DB_READBACK_MISSING");
    if (
      stored.source !== data.source ||
      stored.source_url !== data.sourceUrl ||
      Number(stored.fii_buy) !== data.fii.buy ||
      Number(stored.fii_sell) !== data.fii.sell ||
      Number(stored.fii_net) !== data.fii.net ||
      Number(stored.dii_buy) !== data.dii.buy ||
      Number(stored.dii_sell) !== data.dii.sell ||
      Number(stored.dii_net) !== data.dii.net
    ) {
      throw new Error("FII_DII_DB_READBACK_MISMATCH");
    }

    return {
      storedTradeDate: data.date,
      source: data.source,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      attempts: fetched.attempts,
      fii: data.fii,
      dii: data.dii,
      dbReadbackVerified: true,
    };
  });

  console.log("[FII_DII_DAILY] success", JSON.stringify(result));
}

main().catch((err) => {
  console.error("[FII_DII_DAILY] failed", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
