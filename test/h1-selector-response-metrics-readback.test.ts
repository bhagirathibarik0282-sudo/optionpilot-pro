import test from "node:test";
import assert from "node:assert/strict";
import { produceH1LivePublisherPacket } from "../h1-live-publisher-packet-producer.js";

test("publisher preserves exact premium delta gamma metrics without changing gates", () => {
  const identity = { symbol:"NIFTY", side:"CE", strike:24000, expiryDate:"2026-09-08", dte:1, moneyness:"ATM", premiumLtp:102, observedAt:"2026-09-07T08:00:10.000Z", source:"TEST", provenance:"LIVE_RUNTIME_EXACT" };
  const previousPremiumSnapshot = { symbol:"NIFTY", expiry:"2026-09-08", strike:24000, side:"CE", observedAt:"2026-09-07T08:00:00.000Z", ltp:100, delta:0.50, gamma:0.002, source:"LIVE_RUNTIME_EXACT" };
  const currentPremiumSnapshot = { ...previousPremiumSnapshot, observedAt:"2026-09-07T08:00:10.000Z", ltp:102, delta:0.53 };
  const burdenSnapshot = { symbol:"NIFTY", expiryDate:"2026-09-08", strike:24000, side:"CE", dte:1, premiumLtp:102, theta:-1, iv:15, observedAt:"2026-09-07T08:00:10.000Z", source:"LIVE_RUNTIME_EXACT" };
  const capitalLiquidityDteEvidence = { symbol:"NIFTY", dte:1, premiumLtp:102, lotSize:1, bidPrice:101, askPrice:102, bidDepthQuantity:10, askDepthQuantity:10, orderQuantity:1, occurredAt:"2026-09-07T08:00:10.000Z", provenance:"LIVE_RUNTIME_EXACT" };
  const r = produceH1LivePublisherPacket({ identity, previousPremiumSnapshot, currentPremiumSnapshot, premiumPolicy:{maxObservationGapMs:180000,minPremiumMovePct:2,minAbsoluteDeltaChange:0.03,minCurrentGamma:0.001}, burdenSnapshot, multiExpiryPeers:[{expiryDate:"2026-09-15",dte:8,direction:"UP",observedAt:"2026-09-07T08:00:10.000Z",source:"LIVE_RUNTIME_EXACT"},{expiryDate:"2026-09-22",dte:15,direction:"UP",observedAt:"2026-09-07T08:00:10.000Z",source:"LIVE_RUNTIME_EXACT"}], burdenPolicy:{maxObservationAgeMs:60000,maxAbsThetaPctOfPremium:3,minIv:8,maxIv:30,requiredPeerCount:2,maxConflictingPeerCount:0}, capitalLiquidityDteEvidence, capitalLiquidityDtePolicy:{maxCapitalPerTrade:50000,maxRelativeSpreadPct:1.5,minBidDepthCoverageMultiple:2,minAskDepthCoverageMultiple:2,allowFallbackDte5To7:false}, nowIso:"2026-09-07T08:00:10.000Z" });
  assert.equal(r.ready,true);
  assert.deepEqual(r.packet?.responseMetrics,{premiumMovePct:2,absoluteDeltaChange:0.030000000000000027,currentGamma:0.002,observedAt:"2026-09-07T08:00:10.000Z",source:"H1_LIVE_PREMIUM_DELTA_GAMMA_EVALUATOR_V1",provenance:"LIVE_RUNTIME_EXACT"});
  assert.equal(r.packet?.gates.deltaGammaResponseConfirmed?.value,true);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.minPremiumMovePct,2);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.minAbsoluteDeltaChange,0.03);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.minCurrentGamma,0.001);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.premiumPass,true);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.deltaPass,true);
  assert.equal(r.packet?.policyDiagnostics?.premiumDeltaGamma.gammaPass,true);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.theta,-1);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.iv,15);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.maxAbsThetaPctOfPremium,3);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.minIv,8);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.maxIv,30);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.thetaPass,true);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.ivPass,true);
  assert.equal(r.packet?.policyDiagnostics?.thetaIv.thetaIvPass,r.packet?.gates.thetaIvBurdenAcceptable?.value);
});
