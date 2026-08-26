import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase38ModelTruth } from "../phase38-model-provenance.js";
import type { MarketSnapshot1mRow, OptionSnapshot1mRow } from "../db.js";

const market: MarketSnapshot1mRow = {
  symbol: "NIFTY",
  minuteBucket: "2026-08-26T04:30:00.000Z",
  backendTimestamp: "2026-08-26T04:30:05.000Z",
  spotLtp: 24500,
};

function option(overrides: Partial<OptionSnapshot1mRow> = {}): OptionSnapshot1mRow {
  return {
    symbol: "NIFTY",
    minuteBucket: market.minuteBucket,
    expiry: "2026-09-03",
    dte: 8,
    strike: 24500,
    optionType: "CE",
    ltp: 260,
    iv: 18,
    delta: 0.55,
    gamma: 0.0007,
    vega: 12,
    theta: -18,
    quoteTimestamp: "2026-08-26T04:30:02.000Z",
    ...overrides,
  };
}

test("positive-DTE well-conditioned row can receive shadow IV and Greek provenance permission", () => {
  const r = buildPhase38ModelTruth(option(), market);
  assert.equal(r.audit.ivState, "VALID");
  assert.equal(r.audit.ivPermission, true);
  assert.equal(r.audit.greekPermission, true);
  assert.equal(r.audit.greeksState, "VALID");
  assert.equal(r.audit.usability, "USABLE");
  assert.equal(r.conditioningState, "WELL_CONDITIONED");
  assert.equal(r.payload.modelVersion, "LIVE_BS_R10_Q0_ACT365_BISECTION60_V1");
  assert.equal(r.payload.gammaModelVersion, "LIVE_ADV_GREEKS_BS_Q0_ACT365_TFLOOR0001_V1");
  assert.equal(r.payload.gammaProvenance, "SERVER_CALC_ADVANCED_GREEKS_PHASE39_PARITY_VERIFIED");
  assert.equal(r.payload.permissionScope, "SHADOW_RESEARCH_ONLY");
});

test("low-vega IV conditioning blocks IV and Greek permission", () => {
  const r = buildPhase38ModelTruth(option({ strike: 27000, dte: 1, iv: 10, ltp: 0.5, delta: 0.0001, gamma: 0.00001, vega: 0.001, theta: -0.01 }), market);
  assert.equal(r.conditioningState, "ILL_CONDITIONED_LOW_VEGA");
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.audit.greekPermission, false);
  assert.ok(r.audit.reasons.includes("IV_SOLVER_ILL_CONDITIONED"));
});

test("missing Gamma fails closed even when other model inputs exist", () => {
  const r = buildPhase38ModelTruth(option({ gamma: null }), market);
  assert.equal(r.audit.ivPermission, true);
  assert.equal(r.audit.greekPermission, false);
  assert.ok(r.audit.reasons.includes("GAMMA_PROVENANCE_UNVERIFIED"));
});

test("missing spot fails closed and persists unknown conditioning", () => {
  const r = buildPhase38ModelTruth(option(), { ...market, spotLtp: null });
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.audit.greekPermission, false);
  assert.equal(r.conditioningState, "UNKNOWN");
});

test("expiry-day zero DTE remains fail-closed because basic and advanced Greek time semantics conflict", () => {
  const r = buildPhase38ModelTruth(option({ dte: 0 }), market);
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.audit.greekPermission, false);
  assert.equal(r.conditioningState, "UNKNOWN");
  assert.ok(r.audit.reasons.includes("ZERO_DTE_GREEK_SEMANTIC_CONFLICT"));
  assert.equal(r.payload.expiryDayGreekSemantics, "ZERO_DTE_SEMANTIC_CONFLICT");
});
