import assert from "node:assert/strict";
import test from "node:test";
import { buildH1ExactLiveConfigPreflight } from "../h1-exact-live-config-preflight.js";

const rows = [
  { instrument_token: 256265, tradingsymbol: "NIFTY 50", name: "NIFTY 50", expiry: null, strike: 0, instrument_type: "EQ", segment: "INDICES", exchange: "NSE" },
  { instrument_token: 1001, tradingsymbol: "NIFTY26SEPFUT", name: "NIFTY", expiry: "2026-09-24", strike: 0, instrument_type: "FUT", segment: "NFO-FUT", exchange: "NFO" },
  { instrument_token: 2001, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2002, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2101, tradingsymbol: "NIFTY26OCT24000CE", name: "NIFTY", expiry: "2026-10-29", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2102, tradingsymbol: "NIFTY26OCT24000PE", name: "NIFTY", expiry: "2026-10-29", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 264969, tradingsymbol: "INDIA VIX", name: "INDIA VIX", expiry: null, strike: 0, instrument_type: "EQ", segment: "INDICES", exchange: "NSE" },
] as any;

const basePolicy = {
  directionPolicy: { maxObservationGapMs: 10000, minAbsoluteSpotMovePct: 0.05, maxDirectionAgeMs: 15000 },
  greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
  premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0, minAbsoluteDeltaChange: 0, minCurrentGamma: 0 },
  burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 1000, minIv: 0, maxIv: 500, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
  capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 20, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
};

const selections = [
  { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE", moneyness: "ATM", orderQuantity: 150 },
  { symbol: "NIFTY", expiry: "2026-10-29", strike: 24000, side: "CE", moneyness: "ATM", orderQuantity: 150 },
] as any;

test("resolves exact tokens from master and passes final exact-shadow config validation", () => {
  const out = buildH1ExactLiveConfigPreflight(rows, { selections, policy: basePolicy as any });
  assert.equal(out.ready, true);
  assert.equal(out.inferredTokens, false);
  assert.equal(out.writesRailwayVariables, false);
  assert.equal(out.activatesShadow, false);
  const policy = JSON.parse(out.policyJson!);
  assert.deepEqual(policy.contracts.map((x: any) => x.instrumentToken), [2001, 2101]);
  assert.equal(JSON.stringify(policy).includes("expectedPremiumDirection"), false);
});

test("missing selected contract fails closed instead of falling back to another strike or expiry", () => {
  const missing = rows.filter((x: any) => x.instrument_token !== 2101);
  const out = buildH1ExactLiveConfigPreflight(missing, { selections, policy: basePolicy as any });
  assert.equal(out.ready, false);
  assert.equal(out.registryJson, null);
  assert.equal(out.policyJson, null);
  assert.ok(out.blockers.some((x) => x.includes("KITE_OPTION_NOT_UNIQUE")));
});

test("duplicate explicit selection is rejected", () => {
  const out = buildH1ExactLiveConfigPreflight(rows, {
    selections: [selections[0], selections[0]],
    policy: basePolicy as any,
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers[0].startsWith("DUPLICATE_CONTRACT_SELECTION:"));
});

test("insufficient different-expiry peer capacity fails final validation", () => {
  const out = buildH1ExactLiveConfigPreflight(rows, {
    selections: [selections[0]],
    policy: basePolicy as any,
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("KITE_H1_EXACT_INSUFFICIENT_CONFIGURED_PEER_EXPIRIES"));
});

test("static contract direction cannot enter generated policy", () => {
  const bad = selections.map((x: any) => ({ ...x, expectedPremiumDirection: "UP" }));
  const out = buildH1ExactLiveConfigPreflight(rows, { selections: bad, policy: basePolicy as any });
  assert.equal(out.ready, true);
  assert.equal(out.policyJson!.includes("expectedPremiumDirection"), false);
});
