import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.ts";
import { clearH1LiveSelectorRegistry, publishH1LiveGateEvidence } from "../h1-live-selector-registry.ts";
import { buildBusinessShadowFromH1Registry } from "../business-shadow-registry-adapter-v1.ts";

const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE",
  "VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];

function makeSnapshot(now: number) {
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "SNAP-REG-1",
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
      payload: {},
      devilFlags: [],
    })),
    freshnessBudgetsMs: Object.fromEntries(families.map((f) => [f, 1000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  });
}

function publishCandidate(nowIso: string) {
  const gate = (value: boolean) => ({ value, observedAt: nowIso, source: "test", provenance: "LIVE_RUNTIME_EXACT" as const });
  return publishH1LiveGateEvidence({
    identity: {
      symbol: "NIFTY", side: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, moneyness: "ATM",
      premiumLtp: 100, observedAt: nowIso, source: "test", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: {
      capitalFit: gate(true), liquidityOk: gate(true), spreadOk: gate(true),
      premiumResponseConfirmed: gate(true), deltaGammaResponseConfirmed: gate(true),
      thetaIvBurdenAcceptable: gate(true), multiExpiryConflictAbsent: gate(true),
      currentOrNearExpiryUsable: gate(true),
    },
  });
}

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

test("reuses exact-live registry without inventing official candidate authority", () => {
  clearH1LiveSelectorRegistry();
  const nowIso = "2026-09-07T09:30:00.000+05:30";
  const now = Date.parse(nowIso);
  assert.equal(publishCandidate(nowIso).accepted, true);

  const key = "NIFTY:CE:24100:2026-09-08:DTE1:ATM";
  const out = buildBusinessShadowFromH1Registry({
    snapshot: makeSnapshot(now),
    nowIso,
    metrics: [metric],
    evidenceByCandidateKey: {
      [key]: { temporalConfidencePct: 80, premiumEfficiencyPct: 82, liquidityQualityPct: 90 },
    },
  });

  assert.equal(out.ready, true);
  assert.equal(out.matchedSymbolCandidateCount, 1);
  assert.equal(out.selectedCandidateKeySource, "NONE");
  assert.equal(out.bridge!.journal!.anchor.selectedCandidateKey, null);
  assert.equal(out.bridge!.ranking!.bestCandidateKey, key);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  clearH1LiveSelectorRegistry();
});

test("accepts official selected candidate only when supplied upstream and present in registry", () => {
  clearH1LiveSelectorRegistry();
  const nowIso = "2026-09-07T09:31:00.000+05:30";
  const now = Date.parse(nowIso);
  assert.equal(publishCandidate(nowIso).accepted, true);

  const key = "NIFTY:CE:24100:2026-09-08:DTE1:ATM";
  const out = buildBusinessShadowFromH1Registry({
    snapshot: makeSnapshot(now),
    nowIso,
    metrics: [metric],
    evidenceByCandidateKey: {
      [key]: { temporalConfidencePct: 80, premiumEfficiencyPct: 82, liquidityQualityPct: 90 },
    },
    selectedCandidateKey: key,
  });

  assert.equal(out.ready, true);
  assert.equal(out.selectedCandidateKeySource, "UPSTREAM_ONLY");
  assert.equal(out.bridge!.journal!.anchor.selectedCandidateKey, key);
  clearH1LiveSelectorRegistry();
});

test("fails closed when no live registry candidate exists", () => {
  clearH1LiveSelectorRegistry();
  const nowIso = "2026-09-07T09:32:00.000+05:30";
  const out = buildBusinessShadowFromH1Registry({
    snapshot: makeSnapshot(Date.parse(nowIso)),
    nowIso,
    metrics: [metric],
    evidenceByCandidateKey: {},
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("NO_LIVE_REGISTRY_CANDIDATES_FOR_SNAPSHOT_SYMBOL") || out.blockers.includes("H1_LIVE_SELECTOR_REGISTRY_NOT_READY"));
});
