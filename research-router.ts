import { Hono } from "hono";
import {
  getResearchIndexReadiness,
  getResearchIndexSnapshot,
  importHistoricalResearchIndexCsv,
  initResearchIndexRuntime,
  loadHistoricalResearchIndexRange,
  loadLatestResearchIndexData,
  rebuildResearchIndexMetrics,
  researchIndexRuntimeStatus,
} from "./research-index-runtime.js";
import { buildResearchDashboardModel } from "./research-dashboard-model.js";
import { renderResearchDashboardHtml } from "./research-dashboard-view.js";
import type { ResearchIndexCode } from "./research-index-types.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";
import { runH1PilotHttpAudit } from "./h1-pilot-audit-http.js";
import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import { runH1ReplayIntelligenceHttp } from "./h1-replay-intelligence.js";
import { evaluateResearchEngineChainHttp, researchEngineChainRuntimeStatus } from "./research-engine-chain-http.js";
import { getMeaningfulLiveAcceptanceStatus } from "./meaningful-live-acceptance-monitor.js";
import { candidateRankingShadowRuntimeStatus, evaluateCandidateRankingShadowHttp } from "./candidate-ranking-shadow-http.js";

export const researchRouter = new Hono();

function authorizeResearchMutation(c: Parameters<(typeof researchRouter)["post"]>[1] extends (arg: infer C) => unknown ? C : never) {
  const configured = process.env.RESEARCH_ADMIN_TOKEN?.trim();
  if (!configured) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_MUTATIONS_DISABLED" }, 503);
  }
  const supplied = c.req.header("x-research-admin-token")?.trim();
  if (!supplied || supplied !== configured) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_MUTATION_FORBIDDEN" }, 403);
  }
  return null;
}

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

researchRouter.get("/broad-market-size/view", async (c) => {
  await initResearchIndexRuntime();
  const snapshot = await getResearchIndexSnapshot();
  const model = buildResearchDashboardModel(snapshot);
  return c.html(renderResearchDashboardHtml(model));
});

researchRouter.get("/broad-market-size/readiness", async (c) => {
  const ready = await initResearchIndexRuntime();
  if (!ready) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", ready: false, reason: "RESEARCH_DB_UNAVAILABLE" }, 503);
  }
  const audit = await getResearchIndexReadiness();
  return c.json({ ok: true, ...audit });
});

researchRouter.get("/broad-market-size/status", async (c) => c.json(researchIndexRuntimeStatus()));

researchRouter.get("/engine-chain/status", (c) => c.json(researchEngineChainRuntimeStatus()));

researchRouter.post("/engine-chain/evaluate", async (c) => {
  const denied = authorizeResearchMutation(c);
  if (denied) return denied;
  const body = await c.req.json().catch(() => null);
  const result = evaluateResearchEngineChainHttp(body);
  return c.json(result, result.ok ? 200 : 400);
});

researchRouter.get("/candidate-ranking-shadow/status", (c) => {
  return c.json(candidateRankingShadowRuntimeStatus());
});

researchRouter.post("/candidate-ranking-shadow/evaluate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = evaluateCandidateRankingShadowHttp(body);
  return c.json(result, result.ok ? 200 : 400);
});

researchRouter.get("/h1-pilot-audit", async (c) => {
  const result = await runH1PilotHttpAudit();
  return c.json(result, result.audit || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
});

researchRouter.get("/h1-replay", async (c) => {
  const parsed = parseH1ReplayRequest({ symbol: c.req.query("symbol"), tradeDate: c.req.query("date"), fromTime: c.req.query("from"), toTime: c.req.query("to"), scope: c.req.query("scope") });
  if (!parsed.ok) {
    return c.json({ ok: false, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request: null, reason: parsed.reason }, 400);
  }
  const result = await runH1ReplayHttp(parsed.value);
  return c.json(result, result.ok || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
});

researchRouter.get("/h1-replay-intelligence", async (c) => {
  const parsed = parseH1ReplayRequest({ symbol: c.req.query("symbol"), tradeDate: c.req.query("date"), fromTime: c.req.query("from"), toTime: c.req.query("to"), scope: c.req.query("scope") });
  if (!parsed.ok) {
    return c.json({ ok: false, mode: "READ_ONLY_H1_REPLAY_INTELLIGENCE_V1", productionImpact: "NONE", request: null, reason: parsed.reason }, 400);
  }
  const result = await runH1ReplayIntelligenceHttp(parsed.value);
  return c.json(result, result.ok || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
});

researchRouter.get("/meaningful-live-acceptance", async (c) => {
  const result = await getMeaningfulLiveAcceptanceStatus(c.req.query("symbol"));
  return c.json({ ...result, productionImpact: "NONE" });
});

researchRouter.post("/broad-market-size/load-latest", async (c) => {
  const denied = authorizeResearchMutation(c);
  if (denied) return denied;
  const audit = await loadLatestResearchIndexData();
  if (!audit) return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_DB_UNAVAILABLE" }, 503);
  return c.json({ ok: true, ...audit });
});

researchRouter.post("/broad-market-size/load-history", async (c) => {
  const denied = authorizeResearchMutation(c);
  if (denied) return denied;
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_DATE_RANGE" }, 400);
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const spanDays = Math.floor((end - start) / 86_400_000) + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || spanDays > 370) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: spanDays > 370 ? "RANGE_TOO_LARGE_USE_OFFICIAL_HISTORICAL_CSV" : "INVALID_DATE_RANGE" }, 400);
  }
  const audit = await loadHistoricalResearchIndexRange(from, to);
  if (!audit) return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_DB_UNAVAILABLE" }, 503);
  return c.json({ ok: true, ...audit });
});

researchRouter.post("/broad-market-size/import-csv", async (c) => {
  const denied = authorizeResearchMutation(c);
  if (denied) return denied;
  const indexCode = c.req.query("indexCode") as ResearchIndexCode | undefined;
  if (!indexCode || !RESEARCH_INDEX_CODES.includes(indexCode)) {
    return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_INDEX_CODE", allowed: RESEARCH_INDEX_CODES }, 400);
  }
  const csv = await c.req.text();
  if (!csv.trim()) return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "EMPTY_CSV_BODY" }, 400);
  const result = await importHistoricalResearchIndexCsv(indexCode, csv);
  if (!result) return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_DB_UNAVAILABLE" }, 503);
  return c.json({ ok: true, mode: "RESEARCH_MODE", productionImpact: "NONE", audit: result.audit, metricWrites: result.metricWrites });
});

researchRouter.post("/broad-market-size/rebuild-metrics", async (c) => {
  const denied = authorizeResearchMutation(c);
  if (denied) return denied;
  const ready = await initResearchIndexRuntime();
  if (!ready) return c.json({ ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "RESEARCH_DB_UNAVAILABLE" }, 503);
  const writes = await rebuildResearchIndexMetrics();
  return c.json({ ok: true, mode: "RESEARCH_MODE", productionImpact: "NONE", metricWrites: writes });
});
