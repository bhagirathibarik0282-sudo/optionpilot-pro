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

test("well-conditioned exact live model inputs can grant IV permission but not Gamma-dependent Greek permission", () => {
  const r = buildPhase38ModelTruth(option(), market);
  assert.equal(r.audit.ivState, "VALID");
  assert.equal(r.audit.ivPermission, true);
  assert.equal(r.audit.greekPermission, false);
  assert.equal(r.audit.greeksState, "PARTIAL");
  assert.equal(r.conditioningState, "WELL_CONDITIONED");
  assert.ok(r.audit.reasons.includes("GAMMA_PROVENANCE_UNVERIFIED"));
  assert.equal(r.payload.modelVersion, "LIVE_BS_R10_Q0_ACT365_BISECTION60_V1");
  assert.equal(r.payload.riskFreeRate, 0.10);
  assert.equal(r.payload.dividendYield, 0);
  assert.equal(r.payload.dayCountConvention, "ACT_365");
});

test("low-vega IV conditioning blocks IV permission instead of forcing solver trust", () => {
  const r = buildPhase38ModelTruth(option({ strike: 27000, dte: 1, iv: 10, ltp: 0.5, delta: 0.0001, gamma: 0.00001, vega: 0.001, theta: -0.01 }), market);
  assert.equal(r.conditioningState, "ILL_CONDITIONED_LOW_VEGA");
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.audit.greekPermission, false);
  assert.ok(r.audit.reasons.includes("IV_SOLVER_ILL_CONDITIONED"));
});

test("missing spot fails closed and persists unknown conditioning", () => {
  const r = buildPhase38ModelTruth(option(), { ...market, spotLtp: null });
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.audit.greekPermission, false);
  assert.equal(r.conditioningState, "UNKNOWN");
});

test("expiry-day zero DTE does not receive internal IV permission from this model contract", () => {
  const r = buildPhase38ModelTruth(option({ dte: 0 }), market);
  assert.equal(r.audit.ivPermission, false);
  assert.equal(r.conditioningState, "UNKNOWN");
});
