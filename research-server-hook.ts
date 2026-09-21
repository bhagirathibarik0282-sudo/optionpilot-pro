import type { Hono } from "hono";
import { dbLoadRecent } from "./db.js";
import { H1_LIVE_EXACT_RAW_DEPTH_PERSIST_KIND, H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, type H1LiveExactRawDepthRecord, type H1LiveExactGreekTimingRecord } from "./h1-live-exact-raw-evidence-store.js";
import { H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND, type H1KiteGreekMathCrosscheckPersistRecord } from "./h1-kite-greek-math-crosscheck.js";
import { mountHawkEyeLiveRoute } from "./hawk-eye-live-http-v1.js";
import { researchRouter } from "./research-router.js";
import { installTelegramCombinationBridge } from "./telegram-combination-bridge.js";
import { installMeaningfulLiveTelegramBridge } from "./meaningful-live-telegram.js";
import {
  getMeaningfulLiveAcceptanceStatus,
  installMeaningfulLiveAcceptanceMonitor,
} from "./meaningful-live-acceptance-monitor.js";
import { runFiiDiiCashCatchupRuntime } from "./fii-dii-cash-catchup-runtime.js";
import { scheduleFiiDiiCashCatchup } from "./fii-dii-cash-catchup-scheduler.js";
import { runH1PilotHttpAudit } from "./h1-pilot-audit-http.js";
import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import {
  buildH1EodBusinessBacktestSummary,
  parseH1EodBusinessBacktestTop,
} from "./h1-eod-business-backtest-summary-v1.js";
import { calibrateH1DeltaThreshold } from "./h1-delta-threshold-calibration-v1.js";
import { calibrateH1DeltaByDte } from "./h1-delta-dte-regime-calibration-v1.js";
import { runH1DeltaOosCalibration } from "./h1-delta-oos-calibration-v1.js";
import { runH1Dte0MultidayOosHttp } from "./h1-dte0-multiday-oos-http-v1.js";
import { evaluateH1DeltaThresholdStability } from "./h1-delta-threshold-stability-v1.js";
import { parseLegacyRecorderRecoveryRequest, runLegacyRecorderRecoveryHttp } from "./h1-legacy-recorder-recovery-http.js";
import { runH1ObservedCandidate30mGross } from "./h1-observed-candidate-30m-gross.js";
import { runH1ObservedCandidateMdiEvidenceHttp } from "./h1-observed-candidate-mdi-evidence-http.js";
import { diagnoseObservedCandidateCoverage } from "./h1-observed-candidate-coverage-diagnostic.js";
import { auditCandidateReconstruction } from "./h1-candidate-reconstruction-audit.js";
import { runH1ExactLiveContractDiscoveryHttp } from "./h1-exact-live-contract-discovery-http.js";
import {
  getH1DynamicReadOnlyServerStatus,
  getHawkEyeLiveSource,
  isH1DynamicReadOnlyLiveEnabled,
  startH1DynamicReadOnlyLiveFromServerEnv,
} from "./h1-dynamic-readonly-server-bootstrap.js";
import { collectH1LiveSelectorDecisions, collectH1LiveResponseMetrics, getH1LiveSelectorRegistrySize } from "./h1-live-selector-registry.js";
import { runH1LiveGateEvidenceHistoryHttp } from "./h1-live-gate-evidence-history-http-v1.js";
import { runH1ThreePolicyDescriptiveSummaryHttp } from "./h1-three-policy-descriptive-summary-http-v1.js";
import { H1_EXACT_SHADOW_LIVE_STATUS_PERSIST_KIND, loadLatestH1ExactShadowLiveStatus } from "./h1-exact-shadow-live-service.js";
import {
  H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_PERSIST_KIND,
  loadLatestH1GoldChaseApprovedProducerProof,
} from "./h1-gold-chase-approved-producer-proof-v1.js";

const INTELLIGENCE_LAYER_HREF = "/api/research/broad-market-size/view";
const THEORY_LAB_HREF = "/api/research/h1-theory-dashboard";
const MEANINGFUL_ACCEPTANCE_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

installTelegramCombinationBridge();
installMeaningfulLiveTelegramBridge();
installMeaningfulLiveAcceptanceMonitor();


function runContainedFiiDiiCashCatchup(trigger: "STARTUP" | "EXISTING_1900_IST_WINDOW"): void {
  void runFiiDiiCashCatchupRuntime()
    .then((result) => console.log(`[FII_DII_CASH_CATCHUP] ${JSON.stringify({ trigger, ...result })}`))
    .catch((err) => console.error(`[FII_DII_CASH_CATCHUP] ${JSON.stringify({
      trigger,
      version: "FII_DII_CASH_CATCHUP_RUNTIME_V1",
      ok: false,
      status: "FAILED_CLOSED",
      blocker: err instanceof Error ? err.message : "FII_DII_CASH_CATCHUP_FAILED",
      productionImpact: "CONTEXT_PERSISTENCE_ONLY",
      contextOnly: true,
      grantsDirectionalSupport: false,
      affectsVerdict: false,
      affectsCandidate: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    })}`));
}

if (process.env.NODE_ENV !== "test" && process.env.DATABASE_URL?.trim()) {
  runContainedFiiDiiCashCatchup("STARTUP");
  scheduleFiiDiiCashCatchup(() => runContainedFiiDiiCashCatchup("EXISTING_1900_IST_WINDOW"));
}

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
  mountHawkEyeLiveRoute(app, getHawkEyeLiveSource);
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

  app.get("/api/research/h1-exact-shadow-live-status", async (c) => {
    c.header("Cache-Control", "no-store");
    const latest = await loadLatestH1ExactShadowLiveStatus();
    return c.json({
      ok: true,
      mode: "READ_ONLY_H1_EXACT_SHADOW_LIVE_STATUS_V1",
      productionImpact: "NONE",
      persistKind: H1_EXACT_SHADOW_LIVE_STATUS_PERSIST_KIND,
      startupEvidenceAvailable: latest != null,
      startupStarted: latest?.started === true,
      livePacketProofGranted: false,
      latest,
      blocker: latest ? (latest.started ? null : latest.blockerDetail ?? latest.reason) : "NO_PERSISTED_EXACT_SHADOW_STATUS",
      semantics: "STARTUP_STATE_ONLY_NOT_LIVE_PACKET_PROOF",
      readOnly: true,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    });
  });

  app.get("/api/research/h1-gold-approved-producer-proof", async (c) => {
    c.header("Cache-Control", "no-store");
    const latest = await loadLatestH1GoldChaseApprovedProducerProof();
    return c.json({
      ok: true,
      mode: "READ_ONLY_H1_GOLD_APPROVED_PRODUCER_PROOF_V1",
      productionImpact: "NONE",
      persistKind: H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_PERSIST_KIND,
      proofAvailable: latest != null,
      published: latest?.state === "PUBLISHED" && latest.ready === true,
      latest,
      blocker: latest
        ? (latest.ready ? null : latest.blockers)
        : ["NO_PERSISTED_APPROVED_PRODUCER_PROOF"],
      liveProofOnly: true,
      acceptsReplay: false,
      acceptsSynthetic: false,
      affectsGoldEligibility: false,
      affectsSelector: false,
      affectsTelegram: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      createsOrders: false,
      failClosed: true,
      semantics: "READ_ONLY_DURABLE_APPROVED_PRODUCER_PROOF_NO_MUTATION_NO_AUTHORITY",
    });
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

  app.get("/api/research/h1-live-gate-evidence-history", runH1LiveGateEvidenceHistoryHttp);
  app.get("/api/research/h1-three-policy-descriptive-summary", runH1ThreePolicyDescriptiveSummaryHttp);

  app.get("/api/research/h1-live-exact-depth-history", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = Number(c.req.query("limit") ?? 100);
    const limit = Number.isInteger(requested) ? Math.min(500, Math.max(1, requested)) : 100;
    const records = await dbLoadRecent<H1LiveExactRawDepthRecord>(H1_LIVE_EXACT_RAW_DEPTH_PERSIST_KIND, limit);
    return c.json({
      ok: true,
      mode: "READ_ONLY_H1_LIVE_EXACT_DEPTH_HISTORY_V1",
      productionImpact: "NONE",
      persistKind: H1_LIVE_EXACT_RAW_DEPTH_PERSIST_KIND,
      count: records.length,
      records,
      safety: {
        readOnly: true,
        policyRequired: false,
        thresholdAuthority: "NONE",
        affectsSelector: false,
        affectsTelegram: false,
        affectsVerdict: false,
        affectsExecution: false,
        createsOrders: false,
        failClosed: true,
      },
    });
  });

  app.get("/api/research/h1-live-exact-greek-timing-history", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = Number(c.req.query("limit") ?? 100);
    const limit = Number.isInteger(requested) ? Math.min(500, Math.max(1, requested)) : 100;
    const records = await dbLoadRecent<H1LiveExactGreekTimingRecord>(H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, limit);
    return c.json({
      ok: true,
      mode: "READ_ONLY_H1_LIVE_EXACT_GREEK_TIMING_HISTORY_V1",
      productionImpact: "NONE",
      persistKind: H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND,
      count: records.length,
      records,
      safety: {
        readOnly: true,
        prePolicy: true,
        thresholdAuthority: "NONE",
        affectsSelector: false,
        affectsTelegram: false,
        affectsVerdict: false,
        affectsExecution: false,
        createsOrders: false,
        failClosed: true,
      },
    });
  });

  app.get("/api/research/h1-kite-greek-math-crosscheck-history", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = Number(c.req.query("limit") ?? 100);
    const limit = Number.isInteger(requested) ? Math.min(500, Math.max(1, requested)) : 100;
    const records = await dbLoadRecent<H1KiteGreekMathCrosscheckPersistRecord>(H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND, limit);
    return c.json({
      ok: true,
      mode: "READ_ONLY_H1_KITE_GREEK_MATH_CROSSCHECK_HISTORY_V1",
      productionImpact: "NONE",
      persistKind: H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND,
      count: records.length,
      records,
      safety: {
        readOnly: true,
        policySemantics: "SHADOW_CALIBRATION_ONLY",
        thresholdAuthority: "NONE",
        affectsSelector: false,
        affectsBusinessCard: false,
        affectsTelegram: false,
        affectsVerdict: false,
        affectsExecution: false,
        createsOrders: false,
        failClosed: true,
      },
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

  app.get("/api/research/h1-delta-threshold-stability", (c) => {
    c.header("Cache-Control", "no-store");
    const calibrationP95=Number(c.req.query("calibrationP95"));
    const oosP95=Number(c.req.query("oosP95"));
    const oosPassRateAtCandidate=Number(c.req.query("oosPassRateAtCandidate"));
    const result=evaluateH1DeltaThresholdStability({calibrationP95,oosP95,oosPassRateAtCandidate});
    return c.json({ok:true,mode:"READ_ONLY_H1_DELTA_THRESHOLD_STABILITY_V1",...result});
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
      days.push({tradeDate,rows:(replay.options??[]).map((o:any)=>({symbol:String(o.symbol),minuteBucket:new Date(String(o.minute_bucket)).toISOString(),expiry:String(o.expiry),strike:Number(o.strike),optionType:String(o.option_type),ltp:Number(o.ltp),delta:Number(o.delta),gamma:Number(o.gamma),dte:Number(o.dte)}))});
    }
    return c.json({ok:true,mode:"READ_ONLY_H1_DELTA_OOS_CALIBRATION_V1",...runH1DeltaOosCalibration(days)});
  });

  app.get("/api/research/h1-dte0-multiday-oos", runH1Dte0MultidayOosHttp);

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
      strike:Number(o.strike), optionType:String(o.option_type) as "CE"|"PE", ltp:Number(o.ltp), delta:Number(o.delta), gamma:Number(o.gamma), dte:Number(o.dte),
    }));
    return c.json({
      ok:true,
      mode:"READ_ONLY_H1_DELTA_THRESHOLD_CALIBRATION_V1",
      request:parsed.value,
      ...calibrateH1DeltaThreshold(rows),
      dteCalibration:calibrateH1DeltaByDte(rows),
    });
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

  app.get("/api/research/h1-eod-business-backtest-summary", async (c) => {
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
        mode: "H1_EOD_BUSINESS_BACKTEST_SUMMARY_V1",
        productionImpact: "NONE",
        request: null,
        reason: parsed.reason,
        canonicalLiveProof: false,
        selectorQualificationProven: false,
      }, 400);
    }
    const top = parseH1EodBusinessBacktestTop(c.req.query("top"));
    if (!top.ok) {
      return c.json({
        ok: false,
        mode: "H1_EOD_BUSINESS_BACKTEST_SUMMARY_V1",
        productionImpact: "NONE",
        request: parsed.value,
        reason: top.reason,
        allowedTopRange: [1, 20],
        canonicalLiveProof: false,
        selectorQualificationProven: false,
      }, 400);
    }
    const replay = await runH1ReplayHttp(parsed.value);
    const result = buildH1EodBusinessBacktestSummary(parsed.value, replay, top.value);
    return c.json(result, replay.ok || replay.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
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
