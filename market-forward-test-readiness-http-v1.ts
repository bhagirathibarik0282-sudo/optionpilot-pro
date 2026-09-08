import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import { buildBusinessDashboardV1 } from "./business-dashboard-v1.js";
import { getMeaningfulLiveAcceptanceStatus } from "./meaningful-live-acceptance-monitor.js";
import { runFiiDiiProductionReadinessHttp } from "./canonical-fii-dii-production-readiness-http.js";
import { initResearchIndexRuntime } from "./research-index-runtime.js";
import { safeResearchDbClient } from "./research-index-db.js";
import { buildCanonicalMarketDnaHistoricalFusionRuntime } from "./canonical-market-dna-historical-fusion-runtime.js";
import { buildMarketForwardTestReadiness, type MarketForwardTestSymbol } from "./market-forward-test-readiness-v1.js";
import { buildH1PositioningChangeEvidence, type H1PositioningSnapshot } from "./h1-positioning-change-evidence.js";

export interface MarketForwardTestReadinessQuery {
  symbol?: string | null;
  tradeDate?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
}

type AnyRecord = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoMs(value: unknown): number | null {
  const n = Date.parse(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function normalizedExpiryDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function summarizePositioningRow(row: AnyRecord | null) {
  if (!row) return null;
  const required = {
    fullChainOiPcr: finite(row.full_chain_oi_pcr),
    band7OiPcr: finite(row.band7_oi_pcr),
    volumePcr: finite(row.volume_pcr),
    callWallStrike: finite(row.call_wall_strike),
    callWallStrength: finite(row.call_wall_strength),
    putWallStrike: finite(row.put_wall_strike),
    putWallStrength: finite(row.put_wall_strength),
  };
  const invalidFields = Object.entries(required).filter(([, value]) => value == null || value <= 0).map(([key]) => key);
  return {
    minuteBucket: text(row.minute_bucket),
    rawExpiry: row.expiry instanceof Date ? row.expiry.toISOString() : text(row.expiry),
    normalizedExpiry: normalizedExpiryDate(row.expiry),
    ...required,
    invalidFields,
    validForPositioningSnapshot: text(row.minute_bucket) != null && normalizedExpiryDate(row.expiry) != null && invalidFields.length === 0,
  };
}

export async function runPositioningPairDiagnosticHttp(query: MarketForwardTestReadinessQuery): Promise<{ status: 200 | 400 | 503; body: Record<string, unknown> }> {
  const symbol = String(query.symbol ?? "NIFTY").trim().toUpperCase();
  if (symbol !== "NIFTY" && symbol !== "SENSEX") {
    return { status: 400, body: { ok: false, mode: "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1", productionImpact: "NONE", reason: "FORWARD_TEST_SYMBOL_NOT_SUPPORTED", executionEnabled: false } };
  }

  const parsed = parseH1ReplayRequest({
    symbol,
    tradeDate: query.tradeDate,
    fromTime: query.fromTime ?? "09:15",
    toTime: query.toTime ?? "15:30",
    scope: "CORE",
  });
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, mode: "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1", productionImpact: "NONE", reason: parsed.reason, executionEnabled: false } };
  }

  const replay = await runH1ReplayHttp(parsed.value);
  if (!replay.ok) {
    return { status: 503, body: { ok: false, mode: "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1", productionImpact: "NONE", reason: replay.reason ?? "H1_REPLAY_NOT_READY", executionEnabled: false } };
  }

  const byExpiry = new Map<string, AnyRecord[]>();
  for (const row of replay.chain ?? []) {
    const expiry = normalizedExpiryDate(row.expiry);
    if (!expiry) continue;
    const bucket = byExpiry.get(expiry) ?? [];
    bucket.push(row);
    byExpiry.set(expiry, bucket);
  }

  const expiries = [...byExpiry.keys()].sort();
  const pairs = expiries.map((expiry) => {
    const ordered = (byExpiry.get(expiry) ?? [])
      .filter((row) => isoMs(row.minute_bucket) != null)
      .sort((a, b) => (isoMs(a.minute_bucket) ?? 0) - (isoMs(b.minute_bucket) ?? 0));
    const uniqueByTime = new Map<number, AnyRecord>();
    for (const row of ordered) uniqueByTime.set(isoMs(row.minute_bucket)!, row);
    const unique = [...uniqueByTime.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    const previous = unique.at(-2) ?? null;
    const current = unique.at(-1) ?? null;
    const previousSummary = summarizePositioningRow(previous);
    const currentSummary = summarizePositioningRow(current);
    const gapMs = previous && current && isoMs(previous.minute_bucket) != null && isoMs(current.minute_bucket) != null
      ? (isoMs(current.minute_bucket)! - isoMs(previous.minute_bucket)!)
      : null;

    let validator: unknown = { ready: false, blockers: [unique.length < 2 ? "LESS_THAN_TWO_UNIQUE_TIMESTAMPS" : "INVALID_POSITIONING_SNAPSHOT"] };
    if (previousSummary?.validForPositioningSnapshot && currentSummary?.validForPositioningSnapshot) {
      const toSnapshot = (row: AnyRecord): H1PositioningSnapshot => ({
        symbol: symbol as MarketForwardTestSymbol,
        expiry,
        observedAt: text(row.minute_bucket)!,
        fullChainOiPcr: finite(row.full_chain_oi_pcr)!,
        band7OiPcr: finite(row.band7_oi_pcr)!,
        volumePcr: finite(row.volume_pcr)!,
        callWallStrike: finite(row.call_wall_strike)!,
        callWallStrength: finite(row.call_wall_strength)!,
        putWallStrike: finite(row.put_wall_strike)!,
        putWallStrength: finite(row.put_wall_strength)!,
      });
      validator = buildH1PositioningChangeEvidence(toSnapshot(previous!), toSnapshot(current!), { maxObservationGapMs: 6 * 60_000 });
    }

    return {
      expiry,
      rowCount: unique.length,
      gapMs,
      gapWithinSixMinutes: gapMs != null && gapMs > 0 && gapMs <= 6 * 60_000,
      previous: previousSummary,
      current: currentSummary,
      validator,
    };
  });

  const readyPair = pairs.find((pair) => (pair.validator as { ready?: boolean })?.ready === true) ?? null;
  return {
    status: 200,
    body: {
      ok: true,
      mode: "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1",
      productionImpact: "NONE",
      symbol,
      tradeDate: parsed.value.tradeDate,
      chainRows: replay.chain?.length ?? 0,
      expiryCount: expiries.length,
      ready: readyPair != null,
      readyExpiry: readyPair?.expiry ?? null,
      pairs,
      safety: { readOnly: true, selectorChanged: false, telegramPayloadChanged: false, candidateAuthorityChanged: false, executionEnabled: false, brokerCallMade: false, placesOrder: false, failClosed: true },
    },
  };
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
