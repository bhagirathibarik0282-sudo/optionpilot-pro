import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ThreePolicyDescriptiveSummary } from "../h1-three-policy-descriptive-summary-v1.js";

function row(date: string, overrides: any = {}) {
  return {
    identity: { observedAt: `${date}T10:00:00+05:30` },
    gates: {
      premiumResponseConfirmed: { value: true },
      deltaGammaResponseConfirmed: { value: true },
      thetaIvBurdenAcceptable: { value: true },
      multiExpiryConflictAbsent: { value: true },
      capitalFit: { value: true },
      liquidityOk: { value: true },
      spreadOk: { value: true },
      currentOrNearExpiryUsable: { value: true },
      higherDteUsable: { value: false },
      fallbackDteApproved: { value: false },
      ...overrides,
    },
  };
}

test("summarizes counts and pass rates without creating validation authority", () => {
  const out = buildH1ThreePolicyDescriptiveSummary([
    row("2026-09-21"),
    row("2026-09-22", { premiumResponseConfirmed: { value: false } }),
  ]);
  assert.equal(out.rowCount, 2);
  assert.equal(out.premiumDeltaGamma.observationCount, 2);
  assert.equal(out.premiumDeltaGamma.passCount, 1);
  assert.equal(out.premiumDeltaGamma.passRate, 0.5);
  assert.equal(out.premiumDeltaGamma.uniqueTradingDates, 2);
  assert.equal(out.thetaIvMultiExpiry.passRate, 1);
  assert.equal(out.capitalLiquidityDte.passRate, 1);
  assert.equal(out.validationDecision, null);
  assert.equal(out.acceptanceCriteriaApplied, false);
  assert.equal(out.productionPromotionEligible, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("does not silently drop malformed policy evidence", () => {
  const out = buildH1ThreePolicyDescriptiveSummary([
    null,
    { identity: { observedAt: "bad-date" }, gates: {} },
  ]);
  assert.equal(out.premiumDeltaGamma.observationCount, 0);
  assert.equal(out.premiumDeltaGamma.malformedCount, 2);
  assert.equal(out.thetaIvMultiExpiry.malformedCount, 2);
  assert.equal(out.capitalLiquidityDte.malformedCount, 2);
  assert.equal(out.premiumDeltaGamma.passRate, null);
});

test("requires a DTE usability gate in the capital/liquidity summary", () => {
  const out = buildH1ThreePolicyDescriptiveSummary([
    row("2026-09-21", {
      currentOrNearExpiryUsable: { value: false },
      higherDteUsable: { value: false },
      fallbackDteApproved: { value: false },
    }),
  ]);
  assert.equal(out.capitalLiquidityDte.passCount, 0);
  assert.equal(out.capitalLiquidityDte.failCount, 1);
});
