import { PostgresResearchIndexStore } from "./research-index-store.js";
import { safeResearchDbClient } from "./research-index-db.js";
import { DefaultResearchIndexDerivedEngine } from "./research-index-derived.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";
import { buildResearchIndexApiSnapshot, type ResearchIndexApiSnapshot } from "./research-intelligence-api.js";
import type { ResearchIndexCode, ResearchIndexDailyRecord, ResearchIndexMetrics } from "./research-index-types.js";

const store = new PostgresResearchIndexStore(safeResearchDbClient);
const derived = new DefaultResearchIndexDerivedEngine();

let schemaInitAttempted = false;
let schemaReady = false;

export async function initResearchIndexRuntime(): Promise<boolean> {
  if (schemaInitAttempted) return schemaReady;
  schemaInitAttempted = true;
  schemaReady = await store.ensureSchema();
  return schemaReady;
}

export async function rebuildResearchIndexMetrics(): Promise<number> {
  const histories: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>> = {};
  for (const code of RESEARCH_INDEX_CODES) histories[code] = await store.getHistory(code, 320);

  const nifty50 = histories.NIFTY50 ?? [];
  if (nifty50.length === 0) return 0;

  let writes = 0;
  for (const code of RESEARCH_INDEX_CODES) {
    const history = histories[code] ?? [];
    if (history.length === 0) continue;
    const metrics = derived.buildMetrics(history, nifty50);
    for (const metric of metrics) {
      if (await store.upsertMetrics(metric)) writes += 1;
    }
  }
  return writes;
}

export async function getResearchIndexSnapshot(): Promise<ResearchIndexApiSnapshot> {
  const rowsByIndex: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>> = {};
  const metricsByIndex: Partial<Record<ResearchIndexCode, ResearchIndexMetrics[]>> = {};

  for (const code of RESEARCH_INDEX_CODES) {
    rowsByIndex[code] = await store.getHistory(code, 320);
    metricsByIndex[code] = await store.getMetrics(code, 320);
  }

  return buildResearchIndexApiSnapshot(rowsByIndex, metricsByIndex);
}

export function researchIndexRuntimeStatus() {
  return {
    mode: "RESEARCH_MODE" as const,
    productionImpact: "NONE" as const,
    schemaInitAttempted,
    schemaReady,
  };
}
