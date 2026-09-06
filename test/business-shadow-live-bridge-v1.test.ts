import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.ts";
import { buildBusinessShadowLiveBridge } from "../business-shadow-live-bridge-v1.ts";

const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE",
  "VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];

function snapshot() {
  const now = 1_000_000;
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "SNAP-1",
    symbol: "NIFTY",
    asOfMs: now,
    minuteClosed: false,
    connectionId: "C1",
    instrumentMasterVersion: "IM1",
    components: families.map((family, i) => ({
      family,
      status: "VERIFIED" as const,
      exchangeTimestampMs: now - 100,
      receivedAtMs: now - 90,
      processedAtMs: now - 80,
      ingestSeq: i + 1,
      provenance: "KITE_WS" as const,
      source: "test",
      payload: { opaque: true },
      devilFlags: [],
    })),
    freshnessBudgetsMs: Object.fromEntries(families.map((f) => [f, 1000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  });
}

const candidate = {
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 24100,
  expiryDate: "2026-09-08",
  dte: 1,
  moneyness: "ATM" as const,
  premiumLtp: 100,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
};

const metric = {
  version: "OPTION_BUYER_BUSINESS_METRICS_V1",
  ready: true,
  semantics: "RESEARCH_SHADOW_ONLY" as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

test("binds only verified canonical snapshot to shadow ranking and immutable T0 journal", () => {
  const out = buildBusinessShadowLiveBridge({
    snapshot: snapshot(),
    decisionId: "D1",
    selectedCandidateKey: "NIFTY:CE:24100:2026-09-08:DTE1:ATM",
    candidateRankingInputs: [{ candidate, evidence: { premiumEfficiencyPct: 80, liquidityQualityPct: 90, temporalConfidencePct: 75 } }],
    metrics: [metric],
    marketState: "BULLISH_REVERSAL_BUILDING",
    sellerStressState: "DEFENCE_WEAKENING",
    opportunityStage: "ACTIVE",
  });
  assert.equal(out.ready, true);
  assert.equal(out.snapshotId, "SNAP-1");
  assert.equal(out.ranking!.semantics, "RESEARCH_SHADOW_ONLY");
  assert.equal(out.journal!.anchor.snapshotId, "SNAP-1");
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsStars, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.rawPayloadHeuristicsUsed, false);
});

test("fails closed if a metric tries to gain authority", () => {
  const out = buildBusinessShadowLiveBridge({
    snapshot: snapshot(),
    decisionId: "D1",
    selectedCandidateKey: null,
    candidateRankingInputs: [{ candidate, evidence: { premiumEfficiencyPct: 80, liquidityQualityPct: 90, temporalConfidencePct: 75 } }],
    metrics: [{ ...metric, affectsTelegram: true as never }],
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("SHADOW_METRIC_AUTHORITY_BOUNDARY_INVALID"));
});

test("fails closed when canonical snapshot is not strict-filter ready", () => {
  const bad = snapshot();
  bad.readyForStrictFiltering = false;
  bad.newEntryGate = "BLOCK_NEW_ENTRIES";
  const out = buildBusinessShadowLiveBridge({
    snapshot: bad,
    decisionId: "D1",
    selectedCandidateKey: null,
    candidateRankingInputs: [{ candidate, evidence: { premiumEfficiencyPct: 80, liquidityQualityPct: 90, temporalConfidencePct: 75 } }],
    metrics: [metric],
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("CANONICAL_VERIFIED_SNAPSHOT_REQUIRED"));
});
