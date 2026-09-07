import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import { buildBusinessDashboardV1 } from "./business-dashboard-v1.js";
import { getMeaningfulLiveAcceptanceStatus } from "./meaningful-live-acceptance-monitor.js";
import { runFiiDiiProductionReadinessHttp } from "./canonical-fii-dii-production-readiness-http.js";
import { initResearchIndexRuntime } from "./research-index-runtime.js";
import { safeResearchDbClient } from "./research-index-db.js";
import { buildCanonicalMarketDnaHistoricalFusionRuntime } from "./canonical-market-dna-historical-fusion-runtime.js";
import { buildMarketForwardTestReadiness, type MarketForwardTestSymbol } from "./market-forward-test-readiness-v1.js";

export interface MarketForwardTestReadinessQuery {
  symbol?: string | null;
  tradeDate?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
}

export async function runMarketForwardTestReadinessHttp(query: MarketForwardTestReadinessQuery): Promise<{ status: 200 | 400 | 503; body: Record<string, unknown> }> {
  const symbol = String(query.symbol ?? "NIFTY").trim().toUpperCase();
  if (symbol !== "NIFTY" && symbol !== "SENSEX") {
    return {
      status: 400,
      body: {
        ok: false,
        mode: "READ_ONLY_MARKET_FORWARD_TEST_READINESS_V1",
        productionImpact: "NONE",
        reason: "FORWARD_TEST_SYMBOL_NOT_SUPPORTED",
        allowed: ["NIFTY", "SENSEX"],
        executionEnabled: false,
      },
    };
  }

  const parsed = parseH1ReplayRequest({
    symbol,
    tradeDate: query.tradeDate,
    fromTime: query.fromTime ?? "09:15",
    toTime: query.toTime ?? "15:30",
    scope: "CORE",
  });
  if (!parsed.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        mode: "READ_ONLY_MARKET_FORWARD_TEST_READINESS_V1",
        productionImpact: "NONE",
        reason: parsed.reason,
        executionEnabled: false,
      },
    };
  }

  const replay = await runH1ReplayHttp(parsed.value);
  if (!replay.ok) {
    return {
      status: replay.reason === "DATABASE_URL_NOT_CONFIGURED" ? 503 : 503,
      body: {
        ok: false,
        mode: "READ_ONLY_MARKET_FORWARD_TEST_READINESS_V1",
        productionImpact: "NONE",
        reason: replay.reason ?? "H1_REPLAY_NOT_READY",
        developmentReady: true,
        forwardEvidenceReady: false,
        executionEnabled: false,
      },
    };
  }

  const [telegramAcceptance, fiiDii, researchReady] = await Promise.all([
    getMeaningfulLiveAcceptanceStatus(symbol),
    runFiiDiiProductionReadinessHttp(),
    initResearchIndexRuntime(),
  ]);
  const marketDna = researchReady
    ? await buildCanonicalMarketDnaHistoricalFusionRuntime(safeResearchDbClient)
    : { ok: false, ready: false, blockers: ["RESEARCH_DB_UNAVAILABLE"], contextOnly: true };

  const readiness = buildMarketForwardTestReadiness({
    symbol: symbol as MarketForwardTestSymbol,
    replay,
    dashboard: buildBusinessDashboardV1(symbol as MarketForwardTestSymbol),
    telegramAcceptance,
    fiiDiiContext: fiiDii.body,
    marketDnaContext: marketDna,
  });

  return {
    status: 200,
    body: {
      ok: true,
      ...readiness,
      operationalMeaning: readiness.forwardEvidenceReady
        ? "STRICT_FORWARD_EVIDENCE_OBSERVED_NO_LIVE_EXECUTION_AUTHORITY"
        : "DEVELOPMENT_READY_WAIT_FOR_ORGANIC_MARKET_EVIDENCE",
    },
  };
}
