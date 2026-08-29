import { fetchNseFiiDii } from "./fii-dii-nse.js";
import {
  ensureFiiDiiSchema,
  latestRecordedMarketSessionDate,
  upsertFiiDiiCashDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";

async function main(): Promise<void> {
  const result = await withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);
    const expectedTradingDate = await latestRecordedMarketSessionDate(pool);
    const data = await fetchNseFiiDii(fetch, expectedTradingDate);
    await upsertFiiDiiCashDaily(pool, data);
    return { expectedTradingDate, storedTradeDate: data.date, source: data.source, fetchedAt: data.fetchedAt };
  });

  console.log("[FII_DII_DAILY] success", JSON.stringify(result));
}

main().catch((err) => {
  console.error("[FII_DII_DAILY] failed", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
