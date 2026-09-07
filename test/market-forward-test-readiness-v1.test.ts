import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketForwardTestReadiness } from "../market-forward-test-readiness-v1.js";

function replay() {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: { symbol: "NIFTY", tradeDate: "2026-09-08", fromTime: "09:15", toTime: "09:24", scope: "CORE" },
    counts: { market: 4, options: 8, chain: 4, markers: 4, canonical: 4 },
    market: [{ minute_bucket: "2026-09-08T03:45:00.000Z" }],
    options: [
      { minute_bucket: "2026-09-08T03:45:00.000Z", expiry: "2026-09-08", strike: 23800, option_type: "CE", oi: 1000, oi_change: 50, derived_oi_change: null, derived_oi_change_source: null, derived_oi_change_gap_seconds: null },
      { minute_bucket: "2026-09-08T03:48:00.000Z", expiry: "2026-09-08", strike: 23800, option_type: "CE", oi: 1060, oi_change: 55, derived_oi_change: 60, derived_oi_change_source: "DERIVED_PREVIOUS_PERSISTED_SNAPSHOT", derived_oi_change_gap_seconds: 180 },
    ],
    chain: [
      { minute_bucket: "2026-09-08T03:45:00.000Z", expiry: "2026-09-08", full_chain_oi_pcr: 0.9, band7_oi_pcr: 0.95, volume_pcr: 0.92, call_wall_strike: 23900, call_wall_strength: 100, put_wall_strike: 23700, put_wall_strength: 100 },
      { minute_bucket: "2026-09-08T03:48:00.000Z", expiry: "2026-09-08", full_chain_oi_pcr: 0.94, band7_oi_pcr: 1.01, volume_pcr: 0.96, call_wall_strike: 23950, call_wall_strength: 90, put_wall_strike: 23750, put_wall_strength: 115 },
    ],
    canonical: [],
    continuity: { cadenceMinutes: 3, expectedBuckets: 4, observedMarkerBuckets: 4, missingBuckets: [], firstObserved: "2026-09-08T03:45:00.000Z", lastObserved: "2026-09-08T03:54:00.000Z", coveragePct: 100, complete: true, truthCounts: { TRUE: 4 }, canonicalArchiveBuckets: 4, canonicalCoveragePct: 100, allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB" },
  } as any;
}

function dashboard() {
  return {
    symbol: "NIFTY",
    ready: true,
    state: "CANDIDATE_READY",
    candidate: { candidateKey: "NIFTY|CE|23800|2026-09-08" },
    horizons: [
      { horizon: "INTRADAY", action: "BUYER_FAVOURED", buyerStars: 5, sellerStars: 2, devilCheck: "PASS" },
      { horizon: "MULTIDAY", action: "BUYER_FAVOURED", buyerStars: 4, sellerStars: 2, devilCheck: "PASS" },
      { horizon: "EXPIRY", action: "BUYER_FAVOURED", buyerStars: 5, sellerStars: 1, devilCheck: "PASS" },
    ],
  } as any;
}

function telegram(candidateKey = "NIFTY|CE|23800|2026-09-08") {
  return {
    ok: true,
    symbols: {
      NIFTY: {
        acceptance: "PASS_MEANINGFUL_EVENT_AND_JOURNAL_VERIFIED",
        journal: { latest: { candidateKey } },
      },
    },
  };
}

const readyContext = { ok: true, ready: true, blockers: [] };

test("strict forward evidence requires derived OI, positioning, canonical candidate and meaningful Telegram identity", () => {
  const out = buildMarketForwardTestReadiness({
    symbol: "NIFTY",
    replay: replay(),
    dashboard: dashboard(),
    telegramAcceptance: telegram(),
    fiiDiiContext: readyContext,
    marketDnaContext: readyContext,
  });
  assert.equal(out.developmentReady, true);
  assert.equal(out.forwardEvidenceReady, true);
  assert.equal(out.state, "STRICT_FORWARD_EVIDENCE_PROVEN");
  assert.equal(out.gates.derivedOiTruth.ready, true);
  assert.equal(out.gates.derivedOiTruth.derivedRows, 1, "null first observation must not be coerced into a zero derived row");
  assert.equal(out.gates.derivedOiTruth.separateNativeAndDerivedFieldsObserved, true);
  assert.equal(out.gates.positioningContext.ready, true);
  assert.equal(out.gates.sameCanonicalCandidateDashboardTelegram, true);
  assert.equal(out.safety.executionEnabled, false);
  assert.equal(out.safety.placesOrder, false);
});

test("development stays ready but live proof stays pending before post-deploy derived OI exists", () => {
  const r = replay();
  r.options = r.options.map((row: any) => ({ ...row, derived_oi_change: null, derived_oi_change_source: null, derived_oi_change_gap_seconds: null }));
  const out = buildMarketForwardTestReadiness({ symbol: "NIFTY", replay: r, dashboard: dashboard(), telegramAcceptance: telegram(), fiiDiiContext: readyContext, marketDnaContext: readyContext });
  assert.equal(out.developmentReady, true);
  assert.equal(out.forwardEvidenceReady, false);
  assert.equal(out.state, "DEVELOPMENT_READY_LIVE_PROOF_PENDING");
  assert.ok(out.liveBlockers.includes("DERIVED_OI_NOT_OBSERVED_YET"));
});

test("wrong OI provenance and candidate identity mismatch fail closed without enabling execution", () => {
  const r = replay();
  r.options[1].derived_oi_change_source = "UNKNOWN_SOURCE";
  const out = buildMarketForwardTestReadiness({ symbol: "NIFTY", replay: r, dashboard: dashboard(), telegramAcceptance: telegram("OTHER"), fiiDiiContext: { ready: false, blockers: ["ACCUMULATING"] }, marketDnaContext: { ready: false, blockers: ["WAIT"] } });
  assert.equal(out.forwardEvidenceReady, false);
  assert.ok(out.liveBlockers.includes("DERIVED_OI_TRUTH_INVALID"));
  assert.ok(out.liveBlockers.includes("DASHBOARD_TELEGRAM_CANDIDATE_MISMATCH"));
  assert.equal(out.context.contextDoesNotBlockDevelopmentReadiness, true);
  assert.equal(out.safety.executionEnabled, false);
  assert.equal(out.safety.failClosed, true);
});

test("replay/dashboard symbol mismatch cannot prove the requested forward-test symbol", () => {
  const d = dashboard();
  d.symbol = "SENSEX";
  const out = buildMarketForwardTestReadiness({ symbol: "NIFTY", replay: replay(), dashboard: d, telegramAcceptance: telegram(), fiiDiiContext: readyContext, marketDnaContext: readyContext });
  assert.equal(out.forwardEvidenceReady, false);
  assert.ok(out.liveBlockers.includes("CANONICAL_BUYER_CANDIDATE_PENDING"));
});
