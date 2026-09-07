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
import { calibrateH1DeltaThreshold } from "./h1-delta-threshold-calibration-v1.js";
import { runH1DeltaOosCalibration } from "./h1-delta-oos-calibration-v1.js";
import { parseLegacyRecorderRecoveryRequest, runLegacyRecorderRecoveryHttp } from "./h1-legacy-recorder-recovery-http.js";
import { runH1ObservedCandidate30mGross } from "./h1-observed-candidate-30m-gross.js";
import { runH1ObservedCandidateMdiEvidenceHttp } from "./h1-observed-candidate-mdi-evidence-http.js";
import { diagnoseObservedCandidateCoverage } from "./h1-observed-candidate-coverage-diagnostic.js";
import { auditCandidateReconstruction } from "./h1-candidate-reconstruction-audit.js";
import { runH1ExactLiveContractDiscoveryHttp } from "./h1-exact-live-contract-discovery-http.js";
import {
  getH1DynamicReadOnlyServerStatus,
  isH1DynamicReadOnlyLiveEnabled,
  startH1DynamicReadOnlyLiveFromServerEnv,
} from "./h1-dynamic-readonly-server-bootstrap.js";
import { collectH1LiveSelectorDecisions, collectH1LiveResponseMetrics, getH1LiveSelectorRegistrySize } from "./h1-live-selector-registry.js";

const INTELLIGENCE_LAYER_HREF = "/api/research/broad-market-size/view";
const THEORY_LAB_HREF = "/api/research/h1-theory-dashboard";
const MEANINGFUL_ACCEPTANCE_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

installTelegramCombinationBridge();
installMeaningfulLiveTelegramBridge();
installMeaningfulLiveAcceptanceMonitor();

// H1 exact live path remains hard-default OFF. Only the exact env value `true`
// may start the read-only WebSocket chain. The chain itself has no direction,
// verdict, Telegram or execution authority and fails closed at every boundary.
if (process.env.NODE_ENV !== "test" && isH1DynamicReadOnlyLiveEnabled()) {
  void startH1DynamicReadOnlyLiveFromServerEnv()
    .then((result) => console.log(`[H1_DYNAMIC_READONLY_LIVE] ${JSON.stringify(result)}`))
    .catch((err) => console.error(`[H1_DYNAMIC_READONLY_LIVE] ${JSON.stringify({
      version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1",
      enabled: true,
      attempted: true,
      started: false,
      reason: err instanceof Error ? err.message : "START_FAILED",
      productionImpact: "NONE",
      readOnly: true,
      affectsDirection: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    })}`));
}

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
        data-optionpilot-theory-lab-shortcut="true"
        href="${THEORY_LAB_HREF}"
        aria-label="Open Date-wise Theory Lab"
        style="position:fixed;right:12px;bottom:108px;z-index:9999;display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid rgba(187,156,255,.55);border-radius:999px;background:rgba(8,18,24,.94);color:#cfbaff;text-decoration:none;font:700 12px/1.1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;box-shadow:0 0 18px rgba(187,156,255,.18);backdrop-filter:blur(8px)">
        <span aria-hidden="true">⌁</span>
        <span>Date-wise Theory Lab</span>
      </a>
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

  app.get("/api/research/h1-legacy-recorder-recovery", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseLegacyRecorderRecoveryRequest({
      symbol: c.req.query("symbol"),
      tradeDate: c.req.query("date"),
    });
    if (!parsed.ok) {
      return c.json({
        ok: false,
        mode: "H1_LEGACY_RECORDER_RECOVERY_V1",
        productionImpact: "NONE",
        reason: parsed.reason,
      }, 400);
    }
    const result = await runLegacyRecorderRecoveryHttp(parsed.symbol, parsed.tradeDate);
    return c.json(result, result.ok || result.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
  });

  app.get("/api/research/h1-dynamic-readonly-live-status", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(getH1DynamicReadOnlyServerStatus());
  });

  app.get("/api/research/h1-live-selector-decisions", (c) => {
    c.header("Cache-Control", "no-store");
    const nowIso = new Date().toISOString();
    const result = collectH1LiveSelectorDecisions(nowIso);
    return c.json({
      ok: true,
      version: "H1_LIVE_SELECTOR_DECISION_READBACK_V1",
      mode: "READ_ONLY",
      productionImpact: "NONE",
      observedAt: nowIso,
      registrySize: getH1LiveSelectorRegistrySize(),
      responseMetrics: collectH1LiveResponseMetrics(nowIso),
      ...result,
      readOnly: true,
      forwardsDownstream: false,
      affectsDirection: false,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      failClosed: true,
    });
  });

  app.get("/api/research/h1-exact-live-contract-discovery", async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await runH1ExactLiveContractDiscoveryHttp({
      symbols: c.req.query("symbols"),
      asOfDate: c.req.query("date"),
    });
    return c.json(result, result.ok ? 200 : 503);
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

  app.get("/api/research/h1-delta-oos-calibration", async (c) => {
    c.header("Cache-Control", "no-store");
    const symbol=c.req.query("symbol") ?? "NIFTY";
    const dates=String(c.req.query("dates") ?? "").split(",").map(x=>x.trim()).filter(Boolean);
    if(dates.length<4 || dates.length>20) return c.json({ok:false,mode:"READ_ONLY_H1_DELTA_OOS_CALIBRATION_V1",productionImpact:"NONE",reason:"DATES_REQUIRE_4_TO_20"},400);
    const days=[] as any[];
    for(const tradeDate of dates){
      const parsed=parseH1ReplayRequest({symbol,tradeDate,fromTime:c.req.query("from")??"09:15",toTime:c.req.query("to")??"15:30",scope:c.req.query("scope")??"CORE"});
      if(!parsed.ok) return c.json({ok:false,mode:"READ_ONLY_H1_DELTA_OOS_CALIBRATION_V1",productionImpact:"NONE",reason:parsed.reason,tradeDate},400);
      const replay=await runH1ReplayHttp(parsed.value);
      if(!replay.ok) return c.json({ok:false,mode:"READ_ONLY_H1_DELTA_OOS_CALIBRATION_V1",productionImpact:"NONE",reason:replay.reason,tradeDate},503);
      days.push({tradeDate,rows:(replay.options??[]).map((o:any)=>({symbol:String(o.symbol),minuteBucket:new Date(String(o.minute_bucket)).toISOString(),expiry:String(o.expiry),strike:Number(o.strike),optionType:String(o.option_type),ltp:Number(o.ltp),delta:Number(o.delta),gamma:Number(o.gamma)}))});
    }
    return c.json({ok:true,mode:"READ_ONLY_H1_DELTA_OOS_CALIBRATION_V1",...runH1DeltaOosCalibration(days)});
  });

  app.get("/api/research/h1-delta-threshold-calibration", async (c) => {
    c.header("Cache-Control", "no-store");
    const parsed = parseH1ReplayRequest({
      symbol: c.req.query("symbol"), tradeDate: c.req.query("date"),
      fromTime: c.req.query("from"), toTime: c.req.query("to"), scope: c.req.query("scope"),
    });
    if (!parsed.ok) return c.json({ ok:false, mode:"READ_ONLY_H1_DELTA_THRESHOLD_CALIBRATION_V1", productionImpact:"NONE", reason:parsed.reason }, 400);
    const replay = await runH1ReplayHttp(parsed.value);
    if (!replay.ok) return c.json({ ok:false, mode:"READ_ONLY_H1_DELTA_THRESHOLD_CALIBRATION_V1", productionImpact:"NONE", reason:replay.reason }, 503);
    const rows=(replay.options ?? []).map((o:any)=>({
      symbol:String(o.symbol), minuteBucket:new Date(String(o.minute_bucket)).toISOString(), expiry:String(o.expiry),
      strike:Number(o.strike), optionType:String(o.option_type) as "CE"|"PE", ltp:Number(o.ltp), delta:Number(o.delta), gamma:Number(o.gamma),
    }));
    return c.json({ ok:true, mode:"READ_ONLY_H1_DELTA_THRESHOLD_CALIBRATION_V1", request:parsed.value, ...calibrateH1DeltaThreshold(rows) });
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
