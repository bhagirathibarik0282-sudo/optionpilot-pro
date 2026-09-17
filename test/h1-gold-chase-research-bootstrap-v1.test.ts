import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import type {
  H1GoldEvidenceAdapterInput,
  H1GoldExactFamilySignal,
} from "../h1-gold-evidence-adapter-v1.js";
import {
  bootstrapH1GoldChaseResearch,
  H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1,
} from "../h1-gold-chase-research-bootstrap-v1.js";
import type { H1GoldChasePremiumPoint } from "../h1-gold-chase-observation-v1.js";

const T = "2026-09-16T06:30:00.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = "NIFTY-20260916-063000";

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
  const freshnessBudgetsMs = Object.fromEntries(canonicalFamilies.map((family) => [family, 30_000])) as Record<CanonicalMarketFamily, number>;
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT_ID,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-ws-connection-1",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: { queueDepth: 0, queueLagMs: 3, droppedPacketCount: 0, backpressureActive: false },
  });
}

function signal(state: "PASS" | "FAIL" | "MISSING", source: string): H1GoldExactFamilySignal {
  return {
    state,
    source,
    snapshotId: SNAPSHOT_ID,
    observedAt: T,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: state === "PASS" ? ["EXACT_DECISION_TIME_EVIDENCE"] : ["RESEARCH_PENDING"],
  };
}

function evidence(premiumPair: "PASS" | "MISSING" = "PASS"): H1GoldEvidenceAdapterInput {
  return {
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: canonicalSnapshot(),
    dataIntegrity: signal("PASS", "H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1"),
    premiumPair: signal(premiumPair, "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"),
    spotStructure: signal("PASS", "H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1"),
    targetFuturesPositioning: signal("PASS", "H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1"),
    leaderPositioning: signal("PASS", "H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1"),
    peerConflictAbsent: signal("MISSING", "H1_GOLD_EXACT_PEER_CONFLICT_ABSENT_V1"),
    chainRepositioning: signal("MISSING", "H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1"),
    executionQuality: signal("PASS", "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1"),
    chasePhase: signal("MISSING", "CHASE_POLICY_RESEARCH_PENDING"),
    horizonComplete: signal("MISSING", "H1_GOLD_IMMUTABLE_HORIZON_COMPLETE_V1"),
  };
}

function premiumPoints(): H1GoldChasePremiumPoint[] {
  return [
    {
      source: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      expiry: "2026-09-22",
      strike: 24000,
      optionType: "CE",
      ltp: 100,
      observedAt: "2026-09-16T06:25:00.000Z",
      receivedAt: "2026-09-16T06:25:00.100Z",
    },
    {
      source: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      expiry: "2026-09-22",
      strike: 24000,
      optionType: "CE",
      ltp: 110,
      observedAt: T,
      receivedAt: "2026-09-16T06:30:00.100Z",
    },
  ];
}

function bootstrapInput() {
  return {
    goldEvidence: evidence(),
    contract: { expiry: "2026-09-22", strike: 24000, optionType: "CE" as const, dte: 6 },
    premiumPoints: premiumPoints(),
    spread: 0.8,
    estimatedSlippage: 0.25,
  };
}

test("Golden shadow candidate can bootstrap exact T0 chase research while strict Gold remains blocked", () => {
  const out = bootstrapH1GoldChaseResearch(bootstrapInput());
  assert.equal(out.version, H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1);
  assert.equal(out.ready, true);
  assert.equal(out.state, "READY_FOR_FORWARD_COLLECTION");
  assert.equal(out.adapted.eligibility.decision, "BLOCKED");
  assert.equal(out.adapted.families.chasePhase, "MISSING");
  assert.equal(out.shadowCandidate.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(out.candidateKey, "NIFTY|2026-09-22|24000|CE");
  assert.equal(out.observation.state, "OBSERVABLE");
  assert.equal(out.observation.features.currentPremium, 110);
  assert.equal(out.journal?.anchor.selectedCandidateKey, out.candidateKey);
  assert.equal(out.journal?.anchor.eligibleCandidates[0]?.premiumLtp, 110);
  assert.equal(out.strictGoldRequired, false);
  assert.equal(out.chasePolicyDefined, false);
  assert.equal(out.affectsGoldEligibility, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("missing hard gate blocks research bootstrap instead of weakening Golden shadow criteria", () => {
  const input = bootstrapInput();
  input.goldEvidence = evidence("MISSING");
  const out = bootstrapH1GoldChaseResearch(input);
  assert.equal(out.ready, false);
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.shadowCandidate.state, "REJECTED");
  assert.ok(out.blockers.some((code) => code.includes("HARD_GATE_MISSING_PREMIUM_PAIR")));
  assert.equal(out.journal, null);
});

test("future premium leakage blocks T0 bootstrap", () => {
  const input = bootstrapInput();
  input.premiumPoints = [
    ...premiumPoints(),
    {
      source: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      expiry: "2026-09-22",
      strike: 24000,
      optionType: "CE",
      ltp: 120,
      observedAt: "2026-09-16T06:31:00.000Z",
      receivedAt: "2026-09-16T06:31:00.100Z",
    },
  ];
  const out = bootstrapH1GoldChaseResearch(input);
  assert.equal(out.ready, false);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("FUTURE_PREMIUM_POINT"));
  assert.equal(out.journal, null);
});
