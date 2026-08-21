// Unit tests for obe-volatility.ts (OBE-3) — run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { buildObe3VolatilityPurchaseCondition, type Obe3Input } from "../obe-volatility.js";

function input(overrides: Partial<Obe3Input> = {}): Obe3Input {
  return {
    m3State: "FLAT_EXACT",
    m5State: "IV_NEAR_REALIZED",
    ivVixRatio: 1.0,
    ...overrides,
  };
}

test("missing M3 -> INSUFFICIENT_DATA", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m3State: null }));
  assert.equal(r.state, "INSUFFICIENT_DATA");
  assert.equal(r.dataQuality, "INSUFFICIENT");
  assert.equal(r.scoringImpact, "NONE");
});

test("M3 explicitly INSUFFICIENT_DATA -> INSUFFICIENT_DATA", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m3State: "INSUFFICIENT_DATA" }));
  assert.equal(r.state, "INSUFFICIENT_DATA");
});

test("missing M5 -> INSUFFICIENT_DATA", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: undefined }));
  assert.equal(r.state, "INSUFFICIENT_DATA");
  assert.equal(r.dataQuality, "INSUFFICIENT");
});

test("M5 explicitly INSUFFICIENT_DATA -> INSUFFICIENT_DATA even if M3 is present", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "INSUFFICIENT_DATA", m3State: "FRONT_LOADED_IV" }));
  assert.equal(r.state, "INSUFFICIENT_DATA");
});

test("M5=REALIZED_ABOVE_IV, no contradiction -> CHEAP_VOL", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "REALIZED_ABOVE_IV", ivVixRatio: 0.8 }));
  assert.equal(r.state, "CHEAP_VOL");
  assert.equal(r.dataQuality, "OK");
});

test("M5=IV_PREMIUM_TO_REALIZED, M3 not front-loaded -> EXPENSIVE_VOL (not crush)", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_PREMIUM_TO_REALIZED", m3State: "BACK_LOADED_IV", ivVixRatio: 1.4 }));
  assert.equal(r.state, "EXPENSIVE_VOL");
});

test("M5=IV_PREMIUM_TO_REALIZED AND M3=FRONT_LOADED_IV -> IV_CRUSH_RISK", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_PREMIUM_TO_REALIZED", m3State: "FRONT_LOADED_IV", ivVixRatio: 1.4 }));
  assert.equal(r.state, "IV_CRUSH_RISK");
});

test("M5=IV_NEAR_REALIZED -> FAIR_VOL regardless of M3", () => {
  const r1 = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_NEAR_REALIZED", m3State: "FRONT_LOADED_IV" }));
  assert.equal(r1.state, "FAIR_VOL");
  const r2 = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_NEAR_REALIZED", m3State: "BACK_LOADED_IV" }));
  assert.equal(r2.state, "FAIR_VOL");
});

test("contradictory evidence: M5 says cheap but IV/VIX ratio strongly expensive -> demoted to FAIR_VOL, never forced bullish/bearish", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "REALIZED_ABOVE_IV", ivVixRatio: 1.5 }));
  assert.equal(r.state, "FAIR_VOL");
  assert.match(r.reason, /contradicts/i);
});

test("contradictory evidence: M5+M3 say crush-risk but IV/VIX ratio strongly cheap -> demoted to FAIR_VOL", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_PREMIUM_TO_REALIZED", m3State: "FRONT_LOADED_IV", ivVixRatio: 0.5 }));
  assert.equal(r.state, "FAIR_VOL");
});

test("high IV/VIX ratio ALONE (M5 near-realized / fair base) does not produce EXPENSIVE_VOL", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_NEAR_REALIZED", ivVixRatio: 5.0 }));
  assert.notEqual(r.state, "EXPENSIVE_VOL");
  assert.notEqual(r.state, "IV_CRUSH_RISK");
  assert.equal(r.state, "FAIR_VOL");
});

test("low IV/VIX ratio ALONE (M5 near-realized / fair base) does not produce CHEAP_VOL", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_NEAR_REALIZED", ivVixRatio: 0.1 }));
  assert.notEqual(r.state, "CHEAP_VOL");
  assert.equal(r.state, "FAIR_VOL");
});

test("ivVixRatio unavailable (null) -> classification still proceeds from M3/M5, dataQuality PARTIAL", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "REALIZED_ABOVE_IV", ivVixRatio: null }));
  assert.equal(r.state, "CHEAP_VOL");
  assert.equal(r.dataQuality, "PARTIAL");
});

test("ivVixRatio of 0 or negative treated as unavailable, not as an extreme cheap signal", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "IV_PREMIUM_TO_REALIZED", m3State: "BACK_LOADED_IV", ivVixRatio: 0 }));
  assert.equal(r.state, "EXPENSIVE_VOL"); // not demoted, since ratio=0 is "unavailable" not "cheap-leaning"
  assert.equal(r.dataQuality, "PARTIAL");
});

test("scoringImpact is always NONE regardless of state", () => {
  const states: Array<Partial<Obe3Input>> = [
    { m5State: "REALIZED_ABOVE_IV" },
    { m5State: "IV_PREMIUM_TO_REALIZED", m3State: "FRONT_LOADED_IV" },
    { m5State: "IV_NEAR_REALIZED" },
    { m3State: null },
  ];
  for (const s of states) {
    const r = buildObe3VolatilityPurchaseCondition(input(s));
    assert.equal(r.scoringImpact, "NONE");
  }
});

test("provenance is always the M3/M5-derived label, never claims Dhan-native", () => {
  const r = buildObe3VolatilityPurchaseCondition(input());
  assert.equal(r.provenance, "DERIVED_FROM_EXISTING_M3_M5_VOL_CONTEXT");
});

test("output never contains a 'score' or numeric delta field (structurally cannot be merged into score)", () => {
  const r = buildObe3VolatilityPurchaseCondition(input({ m5State: "REALIZED_ABOVE_IV" })) as any;
  assert.equal(r.score, undefined);
  assert.equal(r.scoreDelta, undefined);
  assert.equal(r.delta, undefined);
});
