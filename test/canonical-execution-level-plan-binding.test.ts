import test from "node:test";
import assert from "node:assert/strict";
import { bindCanonicalExecutionLevelPlan } from "../canonical-execution-level-plan-binding.js";

const candidateKey = "NIFTY:CE:23800:2026-09-22:DTE2:ATM";
const decisionId = "decision-exec-plan-1";

const consumer:any = {
  version: "CANONICAL_BUSINESS_CONSUMER_V1",
  buyerCandidate: {
    decisionId,
    candidateKey,
    role: "OPTION_BUYER",
    symbol: "NIFTY",
    optionSide: "CE",
    strike: 23800,
    expiryDate: "2026-09-22",
    dte: 2,
    moneyness: "ATM",
    premiumLtp: 100,
    dteBucket: "CURRENT_OR_NEAR",
    sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2",
  },
  horizons: [],
  telegram: { allowed: true, reason: "BUYER_READY" },
  decisionId,
  candidateKey,
  sameCanonicalCandidateForDashboardAndTelegram: true,
  affectsExecution: false,
  createsOrders: false,
  aiMayOverride: false,
};

const planInput:any = {
  symbol: "NIFTY",
  entryPremium: 100,
  invalidationPremium: 90,
  entryTriggerConfirmed: true,
  structureInvalidationConfirmed: true,
  maxLossPerTrade: 1500,
  quantity: 2,
  lotSize: 65,
};

test("binds existing execution level plan only to the locked canonical identity", () => {
  const out = bindCanonicalExecutionLevelPlan({ consumer, planInput });
  assert.equal(out.decision, "READY");
  assert.equal(out.identityLocked, true);
  assert.equal(out.decisionId, decisionId);
  assert.equal(out.candidateKey, candidateKey);
  assert.equal(out.plan?.version, "EXECUTION_LEVEL_PLAN_V1");
  assert.equal(out.plan?.entry, 100);
  assert.equal(out.plan?.stopLoss, 90);
  assert.equal(out.plan?.projectedLoss, 1300);
  assert.equal(out.plan?.t1, 110);
  assert.equal(out.plan?.t2, 115);
  assert.equal(out.plan?.t3, 120);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("fails closed on canonical decision identity mismatch without building a plan", () => {
  const out = bindCanonicalExecutionLevelPlan({
    consumer: {
      ...consumer,
      decisionId: "different-decision",
    },
    planInput,
  });
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.identityLocked, false);
  assert.equal(out.decisionId, null);
  assert.equal(out.candidateKey, null);
  assert.equal(out.plan, null);
  assert.ok(out.blockers.includes("CANONICAL_DECISION_IDENTITY_REQUIRED"));
});

test("fails closed on canonical candidate key mismatch without building a plan", () => {
  const out = bindCanonicalExecutionLevelPlan({
    consumer: {
      ...consumer,
      candidateKey: "different-key",
    },
    planInput,
  });
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.identityLocked, false);
  assert.equal(out.plan, null);
  assert.ok(out.blockers.includes("CANONICAL_CANDIDATE_IDENTITY_REQUIRED"));
});

test("rejects plan symbol drift from the locked candidate", () => {
  const out = bindCanonicalExecutionLevelPlan({
    consumer,
    planInput: { ...planInput, symbol: "SENSEX" },
  });
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.identityLocked, false);
  assert.equal(out.plan, null);
  assert.ok(out.blockers.includes("EXECUTION_LEVEL_PLAN_SYMBOL_MISMATCH"));
});

test("preserves locked identity while propagating an existing execution plan blocker", () => {
  const out = bindCanonicalExecutionLevelPlan({
    consumer,
    planInput: { ...planInput, entryTriggerConfirmed: false },
  });
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.identityLocked, true);
  assert.equal(out.decisionId, decisionId);
  assert.equal(out.candidateKey, candidateKey);
  assert.equal(out.plan?.decision, "BLOCK");
  assert.ok(out.blockers.includes("ENTRY_TRIGGER_NOT_CONFIRMED"));
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});
