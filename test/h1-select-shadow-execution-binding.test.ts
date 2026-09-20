import test from "node:test";
import assert from "node:assert/strict";
import { bindH1SelectToShadowExecution } from "../h1-select-shadow-execution-binding.js";

const SELECT = {
  symbol: "SENSEX",
  expiry: "2026-09-10",
  strike: 75100,
  side: "CE" as const,
  decision: "SELECT" as const,
  reasonCodes: [],
  selectorVersion: "EXECUTION_CANDIDATE_SELECTOR_V2",
};
const DECISION_ID = "decision-shadow-binding-1";
const CANONICAL_KEY = "SENSEX:CE:75100:2026-09-10:DTE1:ATM";
const CANONICAL_CONSUMER: any = {
  version: "CANONICAL_BUSINESS_CONSUMER_V1",
  decisionId: DECISION_ID,
  candidateKey: CANONICAL_KEY,
  buyerCandidate: {
    decisionId: DECISION_ID,
    candidateKey: CANONICAL_KEY,
    role: "OPTION_BUYER",
    symbol: "SENSEX",
    optionSide: "CE",
    strike: 75100,
    expiryDate: "2026-09-10",
    dte: 1,
    moneyness: "ATM",
    premiumLtp: 100,
    dteBucket: "CURRENT_OR_NEAR",
    sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2",
  },
  horizons: [],
  telegram: { allowed: true, reason: "BUYER_READY" },
  sameCanonicalCandidateForDashboardAndTelegram: true,
  affectsExecution: false,
  createsOrders: false,
  aiMayOverride: false,
};

const PASSING_EVIDENCE = {
  orderBuildDecision: "BUILD" as const,
  executionRiskDecision: "ALLOW" as const,
  killSwitchDecision: "ALLOW" as const,
  idempotencyDecision: "ALLOW" as const,
  exactContractBound: true,
  evidencePersistenceConfirmed: true,
  brokerSessionReady: true,
};

test("SELECT with otherwise complete evidence stays blocked until canonical execution levels are bound", () => {
  const result = bindH1SelectToShadowExecution({ selectorDecision: SELECT, canonicalConsumer: CANONICAL_CONSUMER, authorizationEvidence: PASSING_EVIDENCE });
  assert.equal(result.decisionId, DECISION_ID);
  assert.equal(result.candidateKey, CANONICAL_KEY);
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("EXECUTION_LEVEL_EVIDENCE_SOURCE_NOT_BOUND"));
  assert.ok(!result.authorization.reasonCodes.includes("SHADOW_EXECUTION_AUTHORIZED"));
  assert.equal(result.authorization.placesOrder, false);
  assert.equal(result.placesOrder, false);
});

test("BLOCK never reaches authorization even with otherwise passing evidence", () => {
  const result = bindH1SelectToShadowExecution({
    selectorDecision: { ...SELECT, decision: "BLOCK", reasonCodes: ["TEST_BLOCK"] },
    canonicalConsumer: CANONICAL_CONSUMER,
    authorizationEvidence: PASSING_EVIDENCE,
  });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.deepEqual(result.authorization.reasonCodes, ["SELECTOR_DECISION_NOT_SELECT"]);
  assert.equal(result.placesOrder, false);
});

test("SELECT fails closed when execution evidence is incomplete", () => {
  const result = bindH1SelectToShadowExecution({
    selectorDecision: SELECT,
    canonicalConsumer: CANONICAL_CONSUMER,
    authorizationEvidence: { ...PASSING_EVIDENCE, brokerSessionReady: false },
  });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("BROKER_SESSION_NOT_READY"));
  assert.ok(result.authorization.reasonCodes.includes("EXECUTION_LEVEL_EVIDENCE_SOURCE_NOT_BOUND"));
  assert.equal(result.placesOrder, false);
});

test("SELECT cannot authorize without the canonical locked consumer", () => {
  const result = bindH1SelectToShadowExecution({ selectorDecision: SELECT, canonicalConsumer: null, authorizationEvidence: PASSING_EVIDENCE });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("CANONICAL_BUSINESS_CANDIDATE_REQUIRED"));
  assert.equal(result.candidateKey, null);
  assert.equal(result.decisionId, null);
});

test("selector identity drift from the canonical candidate fails closed", () => {
  const result = bindH1SelectToShadowExecution({ selectorDecision: { ...SELECT, strike: 75200 }, canonicalConsumer: CANONICAL_CONSUMER, authorizationEvidence: PASSING_EVIDENCE });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("CANONICAL_SELECTOR_IDENTITY_MISMATCH"));
  assert.equal(result.placesOrder, false);
});

test("a non-authoritative selector version cannot authorize shadow simulation", () => {
  const result = bindH1SelectToShadowExecution({
    selectorDecision: { ...SELECT, selectorVersion: "LEGACY_SELECTOR" },
    canonicalConsumer: CANONICAL_CONSUMER,
    authorizationEvidence: PASSING_EVIDENCE,
  });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("AUTHORITATIVE_SELECTOR_VERSION_REQUIRED"));
  assert.equal(result.placesOrder, false);
});
