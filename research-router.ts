import { Hono } from "hono";
import {
  getResearchIndexSnapshot,
  initResearchIndexRuntime,
  loadHistoricalResearchIndexRange,
  loadLatestResearchIndexData,
  rebuildResearchIndexMetrics,
  researchIndexRuntimeStatus,
} from "./research-index-runtime.js";
import { buildResearchDashboardModel } from "./research-dashboard-model.js";

export const researchRouter = new Hono();

researchRouter.get("/broad-market-size", async (c) => {
  await initResearchIndexRuntime();
  const snapshot = await getResearchIndexSnapshot();
  return c.json(snapshot);
});

researchRouter.get("/broad-market-size/dashboard", async (c) => {
  await initResearchIndexRuntime();
  const snapshot = await getResearchIndexSnapshot();
  return c.json(buildResearchDashboardModel(snapshot));
});

researchRouter.get("/broad-market-size/status", async (c) => {
  return c.json(researchIndexRuntimeStatus());
});

researchRouter.post("/broad-market-size/load-latest", async (c) => {
  const audit = await loadLatestResearchIndexData();
  if (!audit) {
    return c.json({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "RESEARCH_DB_UNAVAILABLE",
    }, 503);
  }
  return c.json({ ok: true, ...audit });
});

researchRouter.post("/broad-market-size/load-history", async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return c.json({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "INVALID_DATE_RANGE",
    }, 400);
  }

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const spanDays = Math.floor((end - start) / 86_400_000) + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || spanDays > 370) {
    return c.json({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: spanDays > 370 ? "RANGE_TOO_LARGE_USE_OFFICIAL_HISTORICAL_CSV" : "INVALID_DATE_RANGE",
    }, 400);
  }

  const audit = await loadHistoricalResearchIndexRange(from, to);
  if (!audit) {
    return c.json({
      ok: false,
      mode: "RESEARCH_MODE",
      productionImpact: "NONE",
      reason: "RESEARCH_DB_UNAVAILABLE",
    }, 503);
  }

  return c.json({ ok: true, ...audit });
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
