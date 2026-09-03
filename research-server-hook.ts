import type { Hono } from "hono";
import { researchRouter } from "./research-router.js";
import { installTelegramCombinationBridge } from "./telegram-combination-bridge.js";
import { installMeaningfulLiveTelegramBridge } from "./meaningful-live-telegram.js";
import {
  getMeaningfulLiveAcceptanceStatus,
  installMeaningfulLiveAcceptanceMonitor,
} from "./meaningful-live-acceptance-monitor.js";
import { runH1PilotHttpAudit } from "./h1-pilot-audit-http.js";
import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import { runH1ObservedCandidate30mGross } from "./h1-observed-candidate-30m-gross.js";
import { runH1ObservedCandidateMdiEvidenceHttp } from "./h1-observed-candidate-mdi-evidence-http.js";
import { diagnoseObservedCandidateCoverage } from "./h1-observed-candidate-coverage-diagnostic.js";
import { auditCandidateReconstruction } from "./h1-candidate-reconstruction-audit.js";

const INTELLIGENCE_LAYER_HREF = "/api/research/broad-market-size/view";
const MEANINGFUL_ACCEPTANCE_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

installTelegramCombinationBridge();
installMeaningfulLiveTelegramBridge();
installMeaningfulLiveAcceptanceMonitor();

const h1StartupAuditTimer = setTimeout(() => {
  void runH1PilotHttpAudit()
    .then((result) => console.log(`[H1_PILOT_STARTUP_AUDIT] ${JSON.stringify(result)}`))
    .catch((err) => console.error(`[H1_PILOT_STARTUP_AUDIT] ${JSON.stringify({
      ok: false,
      mode: "READ_ONLY_H1_PILOT_AUDIT",
      productionImpact: "NONE",
      audit: null,
      reason: err instanceof Error ? err.message : "H1_PILOT_STARTUP_AUDIT_FAILED",
    })}`));
}, 5000);
h1StartupAuditTimer.unref?.();

export function mountResearchRoutes(app: Hono): void {
  app.use("/", async (c, next) => {
    await next();

    if (c.req.method !== "GET") return;
    const response = c.res;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    const html = await response.text();
    if (!html.includes("</body>") || html.includes("data-optionpilot-intelligence-shortcut")) return;

    const shortcut = `
      <a
        data-optionpilot-intelligence-shortcut="true"
        href="${INTELLIGENCE_LAYER_HREF}"
        aria-label="Open Intelligence Layer"
        style="position:fixed;right:12px;bottom:62px;z-index:9999;display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid rgba(0,255,200,.55);border-radius:999px;background:rgba(8,18,24,.94);color:#55ffd8;text-decoration:none;font:700 12px/1.1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;box-shadow:0 0 18px rgba(0,255,200,.18);backdrop-filter:blur(8px)">
        <span aria-hidden="true">✦</span>
        <span>Intelligence Layer</span>
      </a>
    `;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    c.res = new Response(html.replace("</body>", `${shortcut}</body>`), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

  app.get("/api/research/meaningful-live-acceptance", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = (c.req.query("symbol") ?? "").trim().toUpperCase();
    if (requested && !(MEANINGFUL_ACCEPTANCE_SYMBOLS as readonly string[]).includes(requested)) {
      return c.json({
        ok: false,
        mode: "READ_ONLY_MEANINGFUL_LIVE_ACCEPTANCE_V1",
        error: "INVALID_SYMBOL",
        allowed: MEANINGFUL_ACCEPTANCE_SYMBOLS,
      }, 400);
    }
    const result = await getMeaningfulLiveAcceptanceStatus(requested || null);
    return c.json(result);
  });

  app.get("/api/research/h1-observed-candidate-30m-gross", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseH1ReplayRequest({
      symbol: c.req.query("symbol"),
      tradeDate: c.req.query("date"),
      fromTime: c.req.query("from"),
      toTime: c.req.query("to"),
      scope: c.req.query("scope"),
    });
    if (!parsed.ok) {
      return c.json({
        ok: false,
        mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_30M_GROSS_V1",
        productionImpact: "NONE",
        reason: parsed.reason,
      }, 400);
    }
    const result = await runH1ObservedCandidate30mGross(parsed.value);
    return c.json(result, result.ok || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
  });

  app.get("/api/research/h1-observed-candidate-mdi-avoidance", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseH1ReplayRequest({
      symbol: c.req.query("symbol"),
      tradeDate: c.req.query("date"),
      fromTime: c.req.query("from"),
      toTime: c.req.query("to"),
      scope: c.req.query("scope"),
    });
    if (!parsed.ok) {
      return c.json({
        ok: false,
        mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_MDI_AVOIDANCE_V1",
        productionImpact: "NONE",
        reason: parsed.reason,
      }, 400);
    }
    const result = await runH1ObservedCandidateMdiEvidenceHttp(parsed.value);
    return c.json(result, result.ok || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
  });

  app.get("/api/research/h1-observed-candidate-coverage", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseH1ReplayRequest({
      symbol: c.req.query("symbol"),
      tradeDate: c.req.query("date"),
      fromTime: c.req.query("from"),
      toTime: c.req.query("to"),
      scope: c.req.query("scope"),
    });
    if (!parsed.ok) {
      return c.json({ ok: false, mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_COVERAGE_DIAGNOSTIC_V1", productionImpact: "NONE", reason: parsed.reason }, 400);
    }
    const replay = await runH1ReplayHttp(parsed.value);
    const result = diagnoseObservedCandidateCoverage(parsed.value, replay);
    return c.json({ ok: replay.ok && result.blockers.length === 0, ...result, reason: replay.reason }, replay.ok ? 200 : 503);
  });

  app.get("/api/research/h1-candidate-reconstruction-audit", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseH1ReplayRequest({
      symbol: c.req.query("symbol"),
      tradeDate: c.req.query("date"),
      fromTime: c.req.query("from"),
      toTime: c.req.query("to"),
      scope: c.req.query("scope"),
    });
    if (!parsed.ok) {
      return c.json({ ok: false, mode: "READ_ONLY_H1_CANDIDATE_RECONSTRUCTION_AUDIT_V1", productionImpact: "NONE", reason: parsed.reason }, 400);
    }
    const replay = await runH1ReplayHttp(parsed.value);
    const result = auditCandidateReconstruction(parsed.value, replay);
    return c.json({ ok: replay.ok, ...result, reason: replay.reason }, replay.ok ? 200 : 503);
  });

  app.route("/api/research", researchRouter);
}

export const RESEARCH_ROUTE_BASE = "/api/research" as const;
export const RESEARCH_ROUTE_SAFETY = {
  mode: "RESEARCH_MODE",
  productionImpact: "TELEGRAM_PRESENTATION_ONLY",
  affectsVerdict: false,
  affectsTelegram: true,
  affectsExecution: false,
} as const;
