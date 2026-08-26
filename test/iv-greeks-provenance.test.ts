import test from "node:test";
import assert from "node:assert/strict";
import { auditOptionModelTruth, greekDependentEvidenceAllowed, type OptionModelTruthInput } from "../iv-greeks-provenance.js";

function internal(overrides: Partial<OptionModelTruthInput> = {}): OptionModelTruthInput {
  return {
    iv: 12.5,
    delta: 0.52,
    gamma: 0.0012,
    vega: 8.4,
    theta: -5.1,
    ivSource: "INTERNAL_MODEL",
    greeksSource: "INTERNAL_MODEL",
    modelName: "BLACK_SCHOLES_EUROPEAN",
    modelVersion: "BS_V1",
    solverName: "BISECTION",
    solverVersion: "IV_SOLVER_V1",
    spot: 24520,
    optionPrice: 132.4,
    strike: 24500,
    expiry: "2026-08-27",
    valuationTimestamp: "2026-08-26T04:00:05.000Z",
    riskFreeRate: 0.06,
    dividendYield: 0,
    dayCountConvention: "ACT_365",
    ...overrides,
  };
}

test("numeric IV and Greeks with unknown provenance remain BLOCKED", () => {
  const out = auditOptionModelTruth({ iv: 12, delta: 0.5, gamma: 0.001, vega: 8, theta: -4 });
  assert.equal(out.ivState, "UNKNOWN");
  assert.equal(out.greeksState, "UNKNOWN");
  assert.equal(out.usability, "BLOCKED");
  assert.equal(out.ivPermission, false);
  assert.equal(out.greekPermission, false);
  assert.ok(out.reasons.includes("IV_PROVENANCE_UNKNOWN"));
  assert.ok(out.reasons.includes("GREEKS_PROVENANCE_UNKNOWN"));
});

test("complete versioned internal model inputs permit Greek-dependent evidence", () => {
  const out = auditOptionModelTruth(internal());
  assert.equal(out.ivState, "VALID");
  assert.equal(out.greeksState, "VALID");
  assert.equal(out.usability, "USABLE");
  assert.equal(out.ivPermission, true);
  assert.equal(out.greekPermission, true);
  assert.equal(greekDependentEvidenceAllowed(internal()), true);
});

test("missing risk-free rate blocks internal-model permission", () => {
  const out = auditOptionModelTruth(internal({ riskFreeRate: null }));
  assert.equal(out.ivState, "PARTIAL");
  assert.equal(out.greeksState, "PARTIAL");
  assert.equal(out.usability, "BLOCKED");
  assert.equal(out.greekPermission, false);
  assert.ok(out.reasons.includes("RISK_FREE_RATE_MISSING"));
});

test("internal Greeks cannot be usable when IV provenance is not independently proven", () => {
  const out = auditOptionModelTruth(internal({ ivSource: "UNKNOWN" }));
  assert.equal(out.greeksState, "VALID");
  assert.equal(out.ivPermission, false);
  assert.equal(out.greekPermission, false);
  assert.equal(out.usability, "BLOCKED");
});

test("explicit broker field provenance is CONTEXT_ONLY, not model-truth permission", () => {
  const out = auditOptionModelTruth({
    iv: 14,
    delta: 0.48,
    gamma: 0.001,
    vega: 7,
    theta: -4,
    ivSource: "BROKER_FIELD",
    greeksSource: "BROKER_FIELD",
    brokerFieldName: "provider_option_analytics",
    brokerFieldVersion: "provider_schema_2026_08",
  });
  assert.equal(out.ivState, "VALID");
  assert.equal(out.greeksState, "VALID");
  assert.equal(out.usability, "CONTEXT_ONLY");
  assert.equal(out.ivPermission, false);
  assert.equal(out.greekPermission, false);
});

test("broker claim without field/version proof remains blocked", () => {
  const out = auditOptionModelTruth({
    iv: 13,
    delta: 0.5,
    gamma: 0.001,
    vega: 8,
    theta: -4,
    ivSource: "BROKER_FIELD",
    greeksSource: "BROKER_FIELD",
  });
  assert.equal(out.ivState, "PARTIAL");
  assert.equal(out.greeksState, "PARTIAL");
  assert.equal(out.usability, "BLOCKED");
  assert.ok(out.reasons.includes("BROKER_FIELD_NAME_MISSING"));
  assert.ok(out.reasons.includes("BROKER_FIELD_VERSION_MISSING"));
});
