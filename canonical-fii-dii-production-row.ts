import type { FiiDiiDailyRow } from "./canonical-fii-dii-official-context.ts";
import type { NormalizedFiiDiiCash } from "./fii-dii-nse.ts";

export function normalizedCashFromOfficialRows(input: {
  rows: FiiDiiDailyRow[];
  sourceUrl: string;
  fetchedAt?: string;
}): NormalizedFiiDiiCash {
  if (!Array.isArray(input.rows) || input.rows.length !== 2) {
    throw new Error("FII_DII_PRODUCTION_EXACT_TWO_ROWS_REQUIRED");
  }
  if (!/^https:\/\/www\.nseindia\.com\/api\/fiidiiTrade(?:Nse|React)$/.test(input.sourceUrl)) {
    throw new Error("FII_DII_PRODUCTION_SOURCE_NOT_OFFICIAL");
  }

  const fii = input.rows.find((row) => row.category === "FII_FPI");
  const dii = input.rows.find((row) => row.category === "DII");
  if (!fii || !dii) throw new Error("FII_DII_PRODUCTION_SESSION_INCOMPLETE");
  if (fii.date !== dii.date) throw new Error("FII_DII_PRODUCTION_DATE_MISMATCH");

  for (const row of [fii, dii]) {
    for (const value of [row.buyCrore, row.sellCrore, row.netCrore]) {
      if (!Number.isFinite(value)) throw new Error("FII_DII_PRODUCTION_VALUE_INVALID");
    }
    if (row.buyCrore < 0 || row.sellCrore < 0) throw new Error("FII_DII_PRODUCTION_VALUE_INVALID");
    if (Math.abs((row.buyCrore - row.sellCrore) - row.netCrore) > 0.02) {
      throw new Error("FII_DII_PRODUCTION_NET_MISMATCH");
    }
  }

  return {
    date: fii.date,
    source: "NSE_FII_DII",
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    fii: { buy: fii.buyCrore, sell: fii.sellCrore, net: fii.netCrore },
    dii: { buy: dii.buyCrore, sell: dii.sellCrore, net: dii.netCrore },
  };
}
