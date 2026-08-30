import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPreTradeDecisionEvidence,
  classifyPreTradeDecisionConflict,
  persistPreTradeDecisionEvidence,
  validatePreTradeDecisionEvidence,
} from "../pre-trade-decision-evidence.js";

const base = {
  tradeId: "TRADE-4M-1",
  candidateKey: "NIFTY:CE:25000:2026-09-03:DTE3:ATM",
  idempotencyKey: "EXEC:2026-08-31:OPEN:SIG-1:NIFTY:CE:25000:2026-09-03",
  contract: {
    index: "NIFTY" as const,
    optionType: "CE" as const,
    strike: 25000,
    expiry: "2026-09-03",
    instrumentToken: 12345,
  },
  candidateDecision: "SELECT" as const,
  liquidityDecision: "ALLOW" as const,
  riskDecision: "ALLOW" as const,
  killSwitchDecision: "RUN" as const,
  idempotencyDecision: "ALLOW" as const,
  orderBuildDecision: "BUILD" as const,
  quantumStatus: "READY" as const,
  overallDecision: "PASS" as const,
  evaluatedAt: "2026-08-31T10:00:00+05:30",
};

test("builds broker-safe PASS pre-trade evidence", () => {
  const e = buildPreTradeDecisionEvidence(base);
  assert.ok(e);
  assert.equal(e.version, "PRE_TRADE_DECISION_V1");
  assert.equal(e.brokerOrderAllowed, false);
  assert.equal(e.contract.instrumentToken, "12345");
  assert.equal(validatePreTradeDecisionEvidence(e), true);
});

test("BLOCK decisions remain valid audit evidence", () => {
  const e = buildPreTradeDecisionEvidence({
    ...base,
    candidateDecision: "BLOCK",
    riskDecision: "BLOCK",
    overallDecision: "BLOCK",
  });
  assert.ok(e);
  assert.equal(e.overallDecision, "BLOCK");
  assert.equal(e.brokerOrderAllowed, false);
});

test("missing stable identity fails closed", () => {
  assert.equal(buildPreTradeDecisionEvidence({ ...base, tradeId: "" }), null);
  assert.equal(buildPreTradeDecisionEvidence({ ...base, candidateKey: "" }), null);
  assert.equal(buildPreTradeDecisionEvidence({ ...base, idempotencyKey: "" }), null);
});

test("invalid timestamp and contract fail closed", () => {
  assert.equal(buildPreTradeDecisionEvidence({ ...base, evaluatedAt: "bad-time" }), null);
  assert.equal(buildPreTradeDecisionEvidence({ ...base, contract: { ...base.contract, strike: 0 } }), null);
  assert.equal(buildPreTradeDecisionEvidence({ ...base, contract: { ...base.contract, expiry: "bad-date" } }), null);
});

test("tampered broker permission fails validation", () => {
  const e = buildPreTradeDecisionEvidence(base)! as any;
  e.brokerOrderAllowed = true;
  assert.equal(validatePreTradeDecisionEvidence(e), false);
});

test("same stable identity and same payload reuses despite timestamp differences", () => {
  const a = buildPreTradeDecisionEvidence(base)!;
  const b = buildPreTradeDecisionEvidence({ ...base, evaluatedAt: "2026-08-31T10:01:00+05:30" })!;
  assert.equal(classifyPreTradeDecisionConflict(b, a), "REUSE");
});

test("same stable identity with changed contract or decision conflicts", () => {
  const a = buildPreTradeDecisionEvidence(base)!;
  const changedContract = buildPreTradeDecisionEvidence({ ...base, contract: { ...base.contract, strike: 25100 } })!;
  const changedDecision = buildPreTradeDecisionEvidence({ ...base, riskDecision: "BLOCK", overallDecision: "BLOCK" })!;
  assert.equal(classifyPreTradeDecisionConflict(changedContract, a), "CONFLICT");
  assert.equal(classifyPreTradeDecisionConflict(changedDecision, a), "CONFLICT");
});

test("instrument token normalization prevents false conflict", () => {
  const a = buildPreTradeDecisionEvidence(base)!;
  const b = buildPreTradeDecisionEvidence({ ...base, contract: { ...base.contract, instrumentToken: "12345" } })!;
  assert.equal(classifyPreTradeDecisionConflict(b, a), "REUSE");
});

test("without durable DB read-back persistence stays unconfirmed", async () => {
  const r = await persistPreTradeDecisionEvidence(base, "2026-08-31T10:00:01+05:30");
  assert.equal(r.persisted, false);
  assert.equal(r.decision, "PERSISTENCE_UNCONFIRMED");
  assert.equal(r.brokerOrderAllowed, false);
});
