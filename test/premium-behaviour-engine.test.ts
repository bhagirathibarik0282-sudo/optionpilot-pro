import test from "node:test";
import assert from "node:assert/strict";
import { classifyPremiumBehaviour, type PremiumBehaviourEvidence } from "../premium-behaviour-engine.ts";

const base: PremiumBehaviourEvidence = {
  dataFresh: true,
  contractValid: true,
  liquidityOk: true,
  selectedPremiumDirectionConfirmed: true,
  responseStrengthConfirmed: true,
  oppositePremiumWarning: false,
  overextended: false,
  ivDominant: false,
  thetaPressure: false,
  diverging: false,
};

test("fully confirmed clean premium response is RESPONDING_WELL", () => {
  const r = classifyPremiumBehaviour(base);
  assert.equal(r.state, "RESPONDING_WELL");
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});

test("missing evidence fails closed as DATA_UNAVAILABLE", () => {
  const r = classifyPremiumBehaviour({ ...base, ivDominant: null });
  assert.equal(r.state, "DATA_UNAVAILABLE");
});

test("stale data fails closed", () => {
  const r = classifyPremiumBehaviour({ ...base, dataFresh: false });
  assert.equal(r.state, "DATA_UNAVAILABLE");
  assert.ok(r.devilFlags.includes("STALE_DATA"));
});

test("divergence has priority over other warning states", () => {
  const r = classifyPremiumBehaviour({ ...base, diverging: true, overextended: true, ivDominant: true });
  assert.equal(r.state, "DIVERGING");
});

test("opposite premium warning has priority before extension and IV labels", () => {
  const r = classifyPremiumBehaviour({ ...base, oppositePremiumWarning: true, overextended: true, ivDominant: true });
  assert.equal(r.state, "OPPOSITE_PREMIUM_WARNING");
});

test("overextended premium is never called healthy response", () => {
  const r = classifyPremiumBehaviour({ ...base, overextended: true });
  assert.equal(r.state, "OVEREXTENDED");
});

test("theta pressure is explicit", () => {
  const r = classifyPremiumBehaviour({ ...base, thetaPressure: true });
  assert.equal(r.state, "THETA_PRESSURE");
});

test("IV-dominant move is explicit", () => {
  const r = classifyPremiumBehaviour({ ...base, ivDominant: true });
  assert.equal(r.state, "IV_DRIVEN");
});

test("incomplete direction or strength confirmation becomes WEAK_RESPONSE", () => {
  assert.equal(classifyPremiumBehaviour({ ...base, responseStrengthConfirmed: false }).state, "WEAK_RESPONSE");
  assert.equal(classifyPremiumBehaviour({ ...base, selectedPremiumDirectionConfirmed: false }).state, "WEAK_RESPONSE");
});

test("bad liquidity cannot produce a trade-positive premium state", () => {
  const r = classifyPremiumBehaviour({ ...base, liquidityOk: false });
  assert.equal(r.state, "DATA_UNAVAILABLE");
  assert.ok(r.devilFlags.includes("LIQUIDITY_GATE_FAILED"));
});
