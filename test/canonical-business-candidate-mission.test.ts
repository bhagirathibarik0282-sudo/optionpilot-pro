import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalBusinessEvidenceInputAdapterResult } from "../canonical-business-evidence-input-adapter.js";
import type { CanonicalBusinessDeterministicScoringResult } from "../canonical-business-deterministic-scoring.js";
import { promoteCanonicalBusinessCandidate } from "../canonical-business-candidate-mission.js";
import { canonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.js";
import { selectExecutionCandidate, type ExecutionCandidateInput } from "../execution-candidate-selector.js";

const now = Date.now();
const hash = "manifest-verified-1";

function evidence(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY"): CanonicalBusinessEvidenceInputAdapterResult {
  return {
    version: "CANONICAL_BUSINESS_EVIDENCE_INPUT_ADAPTER_V1",
    ready: true,
    sourceManifestHash: hash,
    symbol,
    horizons: [],
    verifiedFamilies: [],
    blockedFamilies: [],
    blockers: [],
    readOnly: true,
    presentationInputOnly: true,
    scoresComputed: false,
    candidateSelected: false,
    telegramSent: false,
    createsOrders: false,
    affectsExecution: false,
    aiMayOverride: false,
    failClosed: true,
  };
}

function scoring(
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY",
  action: "BUYER_EDGE" | "SELLER_EDGE" | "WAIT" = "BUYER_EDGE",
): CanonicalBusinessDeterministicScoringResult {
  const horizons = (["INTRADAY", "MULTIDAY", "EXPIRY"] as const).map((horizon) => ({
    horizon,
    buyerScore: action === "BUYER_EDGE" ? 82 : 35,
    sellerScore: action === "SELLER_EDGE" ? 82 : 35,
    buyerContributionByFamily: {} as any,
    sellerContributionByFamily: {} as any,
    view: {
      horizon,
      action,
      buyerStars: action === "BUYER_EDGE" ? 5 as const : 2 as const,
      sellerStars: action === "SELLER_EDGE" ? 5 as const : 2 as const,
      headline: action === "BUYER_EDGE" ? "Buyer edge" : "No buyer edge",
      reasons: ["verified business evidence"],
      devilCheck: "PASS" as const,
    },
  }));
  return {
    version: "CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1",
    ready: true,
    sourceManifestHash: hash,
    symbol,
    businessUse: symbol === "BANKNIFTY" ? "OBSERVATION_ONLY_MONTHLY" : "BUYER_ELIGIBLE",
    horizons,
    blockers: [],
    deterministic: true,
    normalizedEvidenceRequired: true,
    rawPayloadHeuristicsUsed: false,
    aiMayOverride: false,
    candidateSelected: false,
    telegramSent: false,
    createsOrders: false,
    affectsExecution: false,
    wiredIntoServer: false,
    failClosed: true,
  };
}

function candidate(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): ExecutionCandidateInput {
  return {
    symbol,
    side: "PE",
    strike: symbol === "SENSEX" ? 75000 : symbol === "BANKNIFTY" ? 56600 : 23400,
    expiryDate: "2026-09-15",
    dte: symbol === "BANKNIFTY" ? 15 : 1,
    moneyness: "ATM",
    premiumLtp: 150,
    capitalFit: true,
    liquidityOk: true,
    spreadOk: true,
    premiumResponseConfirmed: true,
    deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true,
    multiExpiryConflictAbsent: true,
    currentOrNearExpiryUsable: symbol !== "BANKNIFTY",
    higherDteUsable: symbol === "BANKNIFTY",
  };
}

function mission(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY") {
  const input = candidate(symbol);
  return {
    provenance: "LIVE_CANONICAL_BUSINESS_MISSION_V1" as const,
    snapshotId: "snapshot-1",
    decisionId: "decision-1",
    snapshotAsOfMs: now - 1_000,
    nowMs: now,
    telegramHorizon: "INTRADAY" as const,
    businessEvidence: evidence(symbol),
    scoring: scoring(symbol),
    evaluations: [{ candidate: input, selector: selectExecutionCandidate(input) }],
  };
}

test.beforeEach(() => canonicalBusinessRuntimeRegistry.clear());

test("promotes exactly one verified buyer candidate to canonical Telegram transport", () => {
  const out = promoteCanonicalBusinessCandidate(mission());
  assert.equal(out.ready, true);
  assert.equal(out.state, "BUSINESS_CANDIDATE_READY");
  assert.equal(out.telegramTransportReady, true);
  assert.equal(out.candidateKey, "NIFTY:PE:23400:2026-09-15:DTE1:ATM");
  assert.equal(out.meaningfulContractKey, "NIFTY|2026-09-15|23400|PE");
  assert.equal(canonicalBusinessRuntimeRegistry.read("NIFTY")?.candidateKey, out.candidateKey);
});

test("blocks multiple simultaneous SELECT decisions", () => {
  const input = mission();
  const sensex = candidate("SENSEX");
  input.evaluations.push({ candidate: sensex, selector: selectExecutionCandidate(sensex) });
  const out = promoteCanonicalBusinessCandidate(input);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["EXACTLY_ONE_LIVE_SELECT_REQUIRED"]);
});

test("blocks SENSEX while a fresh NIFTY business candidate is active", () => {
  assert.equal(promoteCanonicalBusinessCandidate(mission("NIFTY")).ready, true);
  const out = promoteCanonicalBusinessCandidate(mission("SENSEX"));
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["NIFTY_SENSEX_MUTUAL_EXCLUSION_ACTIVE"]);
});

test("keeps BANKNIFTY observation-only", () => {
  const out = promoteCanonicalBusinessCandidate(mission("BANKNIFTY"));
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["BANKNIFTY_OBSERVATION_ONLY"]);
});

test("blocks seller edge from option-buyer Telegram", () => {
  const input = mission();
  input.scoring = scoring("NIFTY", "SELLER_EDGE");
  const out = promoteCanonicalBusinessCandidate(input);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["BUSINESS_BUYER_EDGE_BELOW_TELEGRAM_GATE"]);
});

test("blocks stale canonical snapshots", () => {
  const input = mission();
  input.snapshotAsOfMs = now - 61_000;
  const out = promoteCanonicalBusinessCandidate(input);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["CANONICAL_SNAPSHOT_STALE_OR_FUTURE"]);
});
