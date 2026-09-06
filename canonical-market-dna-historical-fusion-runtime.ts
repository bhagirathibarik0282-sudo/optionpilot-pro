import type { SqlClient } from "./research-index-store.ts";
import { fetchOfficialSevenIndexMarketValues } from "./canonical-seven-index-market-value-parser.ts";
import { buildMarketDnaContext } from "./canonical-market-dna-context.ts";
import { loadMarketDnaHistoricalMemoryFromDb } from "./canonical-market-dna-historical-memory-runtime.ts";
import { fuseMarketDnaWithHistoricalMemory, type CanonicalMarketDnaHistoricalFusion } from "./canonical-market-dna-historical-fusion.ts";

export async function buildCanonicalMarketDnaHistoricalFusionRuntime(
  db: SqlClient,
  fetchImpl: typeof fetch = fetch,
): Promise<CanonicalMarketDnaHistoricalFusion> {
  const [liveValues, historical] = await Promise.all([
    fetchOfficialSevenIndexMarketValues(fetchImpl),
    loadMarketDnaHistoricalMemoryFromDb(db),
  ]);
  const live = buildMarketDnaContext(liveValues);
  return fuseMarketDnaWithHistoricalMemory(live, historical);
}
