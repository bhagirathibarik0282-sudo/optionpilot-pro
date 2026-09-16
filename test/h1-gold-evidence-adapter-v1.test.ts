import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import {
  adaptH1GoldEvidence,
  type H1GoldEvidenceAdapterInput,
  type H1GoldExactFamilySignal,
} from "../h1-gold-evidence-adapter-v1.js";

const T = "2026-09-07T03:51:00.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = "NIFTY-20260907-035100";
const canonicalFamilies: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

function canonicalSnapshot() {
  const components: CanonicalMarketComponent[] = canonicalFamilies.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: T_MS - 5_000,
    receivedAtMs: T_MS - 4_500,
    processedAtMs: T_MS - 4_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    sourceTimeRange: { fromMs: T_MS - 60_000, toMs: T_MS - 5_000 },
    payload: { family },
  }));
  const freshnessBudgetsMs = Object.fromEntries(
    canonicalFamilies.map((family) => [family, 30_000]),
  ) as Record<CanonicalMarketFamily, number>;

  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT_ID,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-ws-connection-1",
    instrumentMasterVersion: "kite-instruments-2026-09-07",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: {
      queueDepth: 0,
      queueLagMs: 3,
      droppedPacketCount: 0,
      backpressureActive: false,
    },
  });
}

function signal(overrides: Partial<H1GoldExactFamilySignal> = {}): H1GoldExactFamilySignal {
  return {
    state: "PASS",
    source: "EXACT_TEST_SOURCE",
    snapshotId: SNAPSHOT_ID,
    observedAt: T,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["UPSTREAM_EXACT"],
    ...overrides,
  };
}

function input(): H1GoldEvidenceAdapterInput {
  return {
    symbol: "NIFTY",
    side: "PE",
    observedAt: T,
    canonicalSnapshot: canonicalSnapshot(),
    dataIntegrity: signal(),
    premiumPair: signal(),
    spotStructure: signal(),
    targetFuturesPositioning: signal(),
    leaderPositioning: signal(),
    peerConflictAbsent: signal(),
    chainRepositioning: signal(),
    executionQuality: signal(),
    chasePhase: signal(),
    horizonComplete: signal(),
  };
}

test("all canonical-bound exact PASS families remain Gold eligible research-only", () => {
  const out = adaptH1GoldEvidence(input());
  assert.equal(out.canonicalRootValid, true);
  assert.equal(out.eligibility.decision, "GOLD_ELIGIBLE_RESEARCH");
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.calculatesThresholds, false);
});

test("PASS with empty source is downgraded to MISSING and blocks", () => {
  const x = input();
  x.premiumPair = signal({ source: "" });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.premiumPair, "MISSING");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.familyAudit.premiumPair.reasonCodes.includes("MISSING_UPSTREAM_SOURCE"));
});

test("invalid runtime provenance is downgraded to MISSING", () => {
  const x = input();
  x.spotStructure = signal({ provenance: "UNVERIFIED" as H1GoldExactFamilySignal["provenance"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.spotStructure, "MISSING");
  assert.ok(out.familyAudit.spotStructure.reasonCodes.includes("INVALID_UPSTREAM_PROVENANCE"));
});

test("timestamp mismatch can no longer be rescued by a synchronization assertion", () => {
  const x = input();
  x.targetFuturesPositioning = {
    ...signal({ observedAt: "2026-09-07T03:50:55.000Z" }),
    synchronized: true,
  } as H1GoldExactFamilySignal;
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.targetFuturesPositioning, "MISSING");
  assert.ok(out.familyAudit.targetFuturesPositioning.reasonCodes.includes("UPSTREAM_DECISION_TIMESTAMP_MISMATCH"));
});

test("family from another snapshot id is downgraded and blocks Gold", () => {
  const x = input();
  x.leaderPositioning = signal({ snapshotId: "NIFTY-OTHER-SNAPSHOT" });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.leaderPositioning, "MISSING");
  assert.equal(out.familyAudit.leaderPositioning.canonicalBound, false);
  assert.ok(out.familyAudit.leaderPositioning.reasonCodes.includes("UPSTREAM_SNAPSHOT_ID_MISMATCH"));
});

test("canonical root that is not strict-filter ready downgrades all asserted PASS evidence", () => {
  const x = input();
  x.canonicalSnapshot = {
    ...x.canonicalSnapshot,
    ingestTelemetry: {
      ...x.canonicalSnapshot.ingestTelemetry,
      droppedPacketCount: 1,
    },
  };
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.canonicalRootValid, false);
  assert.ok(out.canonicalRootReasonCodes.includes("CANONICAL_NOT_READY_FOR_STRICT_FILTERING"));
  assert.equal(out.families.dataIntegrity, "MISSING");
  assert.equal(out.eligibility.decision, "BLOCKED");
});

test("candidate time must equal canonical snapshot decision time", () => {
  const x = input();
  x.observedAt = "2026-09-07T03:51:03.000Z";
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.canonicalRootValid, false);
  assert.ok(out.canonicalRootReasonCodes.includes("CANONICAL_DECISION_TIMESTAMP_MISMATCH"));
  assert.equal(out.eligibility.decision, "BLOCKED");
});

test("post-entry outcome or MFE evidence is rejected from decision-time Gold evidence", () => {
  const x = input();
  x.horizonComplete = signal({
    source: "FORWARD_OUTCOME_ENGINE",
    reasonCodes: ["FORWARD_MFE_GT_20", "TARGET_HIT"],
  });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.horizonComplete, "MISSING");
  assert.equal(out.familyAudit.horizonComplete.futureLeakageBlocked, true);
  assert.ok(out.familyAudit.horizonComplete.reasonCodes.includes("DECISION_TIME_FUTURE_LEAKAGE_BLOCKED"));
  assert.equal(out.eligibility.decision, "BLOCKED");
});

test("valid upstream FAIL passes through and blocks Gold", () => {
  const x = input();
  x.peerConflictAbsent = signal({ state: "FAIL", reasonCodes: ["STRONG_OPPOSITE_PEER"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.peerConflictAbsent, "FAIL");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.eligibility.reasonCodes.includes("FAILED_PEER_CONFLICT_ABSENT"));
});

test("upstream MISSING stays MISSING and blocks Gold", () => {
  const x = input();
  x.chainRepositioning = signal({ state: "MISSING", reasonCodes: ["CHAIN_SOURCE_UNAVAILABLE"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.chainRepositioning, "MISSING");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.eligibility.reasonCodes.includes("MISSING_CHAIN_REPOSITIONING"));
});

test("source, provenance, snapshot identity and upstream reasons are preserved in family audit", () => {
  const x = input();
  x.executionQuality = signal({
    source: "H1_EXECUTION_EXACT_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["SPREAD_OK", "QUOTE_FRESH"],
  });
  const out = adaptH1GoldEvidence(x);
  const audit = out.familyAudit.executionQuality;
  assert.equal(audit.source, "H1_EXECUTION_EXACT_V1");
  assert.equal(audit.provenance, "LIVE_RUNTIME_EXACT");
  assert.equal(audit.snapshotId, SNAPSHOT_ID);
  assert.equal(audit.canonicalBound, true);
  assert.deepEqual(audit.reasonCodes, ["SPREAD_OK", "QUOTE_FRESH"]);
});
