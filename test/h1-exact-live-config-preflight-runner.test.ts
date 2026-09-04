import assert from "node:assert/strict";
import test from "node:test";
import { runH1ExactLiveConfigPreflight } from "../h1-exact-live-config-preflight-runner.js";

const request: any = {
  selections: [
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE", moneyness: "ATM", orderQuantity: 65 },
    { symbol: "NIFTY", expiry: "2026-10-29", strike: 24000, side: "CE", moneyness: "ATM", orderQuantity: 65 },
  ],
  policy: {
    directionPolicy: { maxObservationGapMs: 10000, minAbsoluteSpotMovePct: 0.05, maxDirectionAgeMs: 15000 },
    greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
    premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0, minAbsoluteDeltaChange: 0, minCurrentGamma: 0 },
    burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 1000, minIv: 0, maxIv: 500, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 20, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
  },
};

const rows: any[] = [
  { instrument_token: 256265, tradingsymbol: "NIFTY 50", name: "NIFTY 50", expiry: null, strike: 0, instrument_type: "EQ", segment: "INDICES", exchange: "NSE" },
  { instrument_token: 1001, tradingsymbol: "NIFTY26SEPFUT", name: "NIFTY", expiry: "2026-09-24", strike: 0, instrument_type: "FUT", segment: "NFO-FUT", exchange: "NFO" },
  { instrument_token: 2001, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2002, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2101, tradingsymbol: "NIFTY26OCT24000CE", name: "NIFTY", expiry: "2026-10-29", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2102, tradingsymbol: "NIFTY26OCT24000PE", name: "NIFTY", expiry: "2026-10-29", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 264969, tradingsymbol: "INDIA VIX", name: "INDIA VIX", expiry: null, strike: 0, instrument_type: "EQ", segment: "INDICES", exchange: "NSE" },
];

const activeAuthority: any = async () => ({
  session: { accessToken: "secret-token", source: "SHARED_DB_AUTHORITY" },
  status: { code: "ACTIVE" },
});

test("fails closed when central authority is unavailable", async () => {
  const out = await runH1ExactLiveConfigPreflight(request, {
    apiKey: "api",
    resolveAuthority: async () => ({ session: null, status: { code: "RECONNECT_REQUIRED" } } as any),
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["KITE_AUTHORITY_RECONNECT_REQUIRED"]);
  assert.equal(out.credentialsExposed, false);
});

test("fails closed when live instrument master is unavailable", async () => {
  const out = await runH1ExactLiveConfigPreflight(request, {
    apiKey: "api",
    resolveAuthority: activeAuthority,
    fetchMaster: async () => ({ ready: false, rows: [], blockers: ["KITE_INSTRUMENT_MASTER_HTTP_403"] } as any),
  });
  assert.equal(out.ready, false);
  assert.equal(out.authorityActive, true);
  assert.equal(out.masterReady, false);
  assert.deepEqual(out.blockers, ["KITE_INSTRUMENT_MASTER_HTTP_403"]);
});

test("successful runner emits only redacted readiness metadata", async () => {
  const out = await runH1ExactLiveConfigPreflight(request, {
    apiKey: "api",
    resolveAuthority: activeAuthority,
    fetchMaster: async ({ accessToken }) => {
      assert.equal(accessToken, "secret-token");
      return { ready: true, rows, blockers: [] } as any;
    },
  });
  assert.equal(out.ready, true);
  assert.equal(out.authorityActive, true);
  assert.equal(out.masterReady, true);
  assert.equal(out.preflightReady, true);
  assert.equal(out.contractCount, 2);
  assert.ok(out.registryTokenCount > 0);
  assert.equal(out.emitsRegistryJson, false);
  assert.equal(out.emitsPolicyJson, false);
  assert.equal(JSON.stringify(out).includes("secret-token"), false);
  assert.equal(out.writesRailwayVariables, false);
  assert.equal(out.activatesShadow, false);
});
