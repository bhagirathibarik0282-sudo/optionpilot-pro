import {
  getResearchIndexReadiness,
  loadLatestResearchIndexData,
  rebuildResearchIndexMetrics,
} from "../research-index-runtime.js";

async function main(): Promise<void> {
  const audit = await loadLatestResearchIndexData();
  if (!audit) throw new Error("RESEARCH_DB_UNAVAILABLE");
  if (audit.totalWriteFailed > 0) {
    throw new Error(`DAILY_RESEARCH_WRITE_FAILURE:${audit.totalWriteFailed}`);
  }

  const metricWrites = audit.totalWritten > 0 ? await rebuildResearchIndexMetrics() : 0;
  const readiness = await getResearchIndexReadiness();

  console.log(JSON.stringify({
    ok: true,
    mode: "RESEARCH_DAILY_AUTO_UPDATE",
    productionImpact: "NONE",
    source: "NIFTY_INDICES_OFFICIAL_DAILY_SNAPSHOT",
    audit,
    metricWrites,
    readiness,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    mode: "RESEARCH_DAILY_AUTO_UPDATE",
    productionImpact: "NONE",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
