import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePremiumPairDivergence,
  candidatePpdForSide,
  comparePremiumPairDivergence,
  type PpdQuote,
} from "../h1-premium-pair-divergence-v1.js";

function quote(
  timestamp: string,
  side: "CE" | "PE",
  price: number,
  overrides: Partial<PpdQuote> = {},
): PpdQuote {
  return {
    timestamp,
    indexSymbol: "NIFTY",
    expiry: "2026-09-08",
    strike: 23850,
    side,
    price,
    priceSource: "LTP_REPLAY",
    ...overrides,
  };
}

function window(
  from: string,
  to: string,
  ceFrom: number,
  ceTo: number,
  peFrom: number,
  peTo: number,
) {
  return calculatePremiumPairDivergence({
    ceFrom: quote(from, "CE", ceFrom),
    ceTo: quote(to, "CE", ceTo),
    peFrom: quote(from, "PE", peFrom),
    peTo: quote(to, "PE", peTo),
  });
}

test("Sep-7 style PE control exposes expansion, opposite collapse and net PPD", () => {
  const result = window(
    "2026-09-07T03:45:00.000Z",
    "2026-09-07T03:51:00.000Z",
    87.55,
    74.70,
    58.15,
    68.55,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.controllingSide, "PE");
  assert.equal(result.pairState, "PE_CONTROLLED_EXPANSION");
  assert.ok(Math.abs(result.peReturnPct - 17.8847807394669) < 1e-9);
  assert.ok(Math.abs(result.ceReturnPct - (-14.677327241576244)) < 1e-9);
  assert.ok(Math.abs(result.candidate.expansionStrengthPct! - 17.8847807394669) < 1e-9);
  assert.ok(Math.abs(result.candidate.oppositeCollapseStrengthPct! - 14.677327241576244) < 1e-9);
  assert.ok(Math.abs(result.candidate.netPpdSeparationPp - 32.562107981043144) < 1e-9);
  assert.ok(Math.abs(candidatePpdForSide(result, "PE")! - 32.562107981043144) < 1e-9);
  assert.equal(result.elapsedMinutes, 6);
  assert.ok(Math.abs(result.windowRate.rawPpdPpPerMinute - (-32.562107981043144 / 6)) < 1e-9);
  assert.equal(result.quality.replayUsesLtp, true);
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.researchOnly, true);
});

test("Aug-31 style CE control is calculated without duplicating candidate logic", () => {
  const result = window(
    "2026-08-31T06:15:00.000Z",
    "2026-08-31T06:21:00.000Z",
    81.8,
    89,
    64.5,
    58.45,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.controllingSide, "CE");
  assert.equal(result.pairState, "CE_CONTROLLED_EXPANSION");
  assert.ok(Math.abs(result.ceReturnPct - 8.80195599022005) < 1e-9);
  assert.ok(Math.abs(result.peReturnPct - (-9.37984496124031)) < 1e-9);
  assert.ok(Math.abs(result.candidate.netPpdSeparationPp - 18.18180095146036) < 1e-9);
  assert.ok(Math.abs(candidatePpdForSide(result, "CE")! - 18.18180095146036) < 1e-9);
});

test("pair state distinguishes both-up and both-decay from true two-sided control", () => {
  const bothUp = window("2026-09-07T03:45:00Z", "2026-09-07T03:48:00Z", 100, 110, 100, 105);
  assert.equal(bothUp.ok, true);
  if (bothUp.ok) assert.equal(bothUp.pairState, "BOTH_UP");

  const bothDecay = window("2026-09-07T03:45:00Z", "2026-09-07T03:48:00Z", 100, 90, 100, 95);
  assert.equal(bothDecay.ok, true);
  if (bothDecay.ok) assert.equal(bothDecay.pairState, "BOTH_DECAY");
});

test("time comparison reports PPD delta/velocity and control flip", () => {
  const previous = window("2026-09-07T03:42:00Z", "2026-09-07T03:45:00Z", 100, 106, 100, 96);
  const current = window("2026-09-07T03:45:00Z", "2026-09-07T03:48:00Z", 106, 98, 96, 108);
  const change = comparePremiumPairDivergence(previous, current);
  assert.equal(change.ok, true);
  if (!change.ok) return;
  assert.equal(change.endpointGapMinutes, 3);
  assert.equal(change.controlFlip, true);
  assert.ok(change.rawPpdDeltaPp < 0);
  assert.ok(change.rawPpdVelocityPpPerMinute < 0);
});

test("fails closed on stale, non-positive, mismatched or asynchronous pair data", () => {
  const stale = calculatePremiumPairDivergence({
    ceFrom: quote("2026-09-07T03:45:00Z", "CE", 100),
    ceTo: quote("2026-09-07T03:48:00Z", "CE", 110, { stale: true }),
    peFrom: quote("2026-09-07T03:45:00Z", "PE", 100),
    peTo: quote("2026-09-07T03:48:00Z", "PE", 90),
  });
  assert.deepEqual(stale, {
    ok: false,
    version: "H1_PREMIUM_PAIR_DIVERGENCE_V1",
    productionImpact: "NONE",
    researchOnly: true,
    reason: "STALE_QUOTE",
  });

  const zero = window("2026-09-07T03:45:00Z", "2026-09-07T03:48:00Z", 0, 10, 100, 90);
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.reason, "NON_POSITIVE_PRICE");

  const mismatch = calculatePremiumPairDivergence({
    ceFrom: quote("2026-09-07T03:45:00Z", "CE", 100),
    ceTo: quote("2026-09-07T03:48:00Z", "CE", 110),
    peFrom: quote("2026-09-07T03:45:00Z", "PE", 100, { strike: 23900 }),
    peTo: quote("2026-09-07T03:48:00Z", "PE", 90, { strike: 23900 }),
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.reason, "IDENTITY_MISMATCH");

  const asynchronous = calculatePremiumPairDivergence({
    ceFrom: quote("2026-09-07T03:45:00Z", "CE", 100),
    ceTo: quote("2026-09-07T03:48:00Z", "CE", 110),
    peFrom: quote("2026-09-07T03:46:00Z", "PE", 100),
    peTo: quote("2026-09-07T03:48:00Z", "PE", 90),
  });
  assert.equal(asynchronous.ok, false);
  if (!asynchronous.ok) assert.equal(asynchronous.reason, "IDENTITY_MISMATCH");
});
