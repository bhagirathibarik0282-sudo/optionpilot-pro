import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ResearchIndexCode } from "../research-index-types.js";
import {
  RESEARCH_INDEX_POPULATION_FILES,
  RESEARCH_INDEX_POPULATION_ORDER,
} from "../research-index-population-manifest.js";
import { importHistoricalResearchIndexBundle } from "../research-index-runtime.js";

async function main(): Promise<void> {
  const root = resolve(process.cwd(), process.env.RESEARCH_DATA_DIR?.trim() || "research-data");
  const bundle: Partial<Record<ResearchIndexCode, string>> = {};
  const missing: Array<{ indexCode: ResearchIndexCode; file: string }> = [];

  for (const indexCode of RESEARCH_INDEX_POPULATION_ORDER) {
    const file = RESEARCH_INDEX_POPULATION_FILES[indexCode];
    const path = resolve(root, file);
    try {
      bundle[indexCode] = await readFile(path, "utf8");
    } catch {
      missing.push({ indexCode, file: path });
    }
  }

  if (missing.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "MISSING_RESEARCH_CSV_FILES",
      missing,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const result = await importHistoricalResearchIndexBundle(bundle);
  if (!result) {
    console.error(JSON.stringify({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "RESEARCH_DB_UNAVAILABLE",
    }, null, 2));
    process.exitCode = 3;
    return;
  }

  console.log(JSON.stringify({
    ok: result.readiness.ready,
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    import: result.audit,
    metricWrites: result.metricWrites,
    readiness: result.readiness,
  }, null, 2));

  if (!result.readiness.ready) process.exitCode = 4;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    reason: "POPULATION_SCRIPT_FAILED",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
