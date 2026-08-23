import { Hono } from "hono";
import {
  getResearchIndexSnapshot,
  initResearchIndexRuntime,
  rebuildResearchIndexMetrics,
  researchIndexRuntimeStatus,
} from "./research-index-runtime.js";

export const researchRouter = new Hono();

researchRouter.get("/broad-market-size", async (c) => {
  await initResearchIndexRuntime();
  const snapshot = await getResearchIndexSnapshot();
  return c.json(snapshot);
});

researchRouter.get("/broad-market-size/status", async (c) => {
  return c.json(researchIndexRuntimeStatus());
});

researchRouter.post("/broad-market-size/rebuild-metrics", async (c) => {
  const ready = await initResearchIndexRuntime();
  if (!ready) {
    return c.json({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "RESEARCH_DB_UNAVAILABLE",
    }, 503);
  }

  const writes = await rebuildResearchIndexMetrics();
  return c.json({
    ok: true,
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    metricWrites: writes,
  });
});
