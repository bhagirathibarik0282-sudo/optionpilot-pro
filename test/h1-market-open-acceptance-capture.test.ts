import test from "node:test";
import assert from "node:assert/strict";
import { buildH1MarketOpenAcceptanceCapture } from "../h1-market-open-acceptance-capture.js";

test("captures exact market-open readiness chain without authority", () => {
  const out = buildH1MarketOpenAcceptanceCapture({
    asOfDate: "2026-09-07",
    connected: true,
    socketState: "OPEN",
    rawEvidenceExpectedTokenCount: 21,
    rawEvidenceFreshTokenCount: 5,
    rawEvidenceMissingTokenCount: 0,
    rawEvidenceStaleTokenCount: 16,
    readOnlyConsumerReadySymbolCount: 1,
    readOnlyDirectionReadySymbolCount: 1,
    readOnlyShadowInputReadySymbolCount: 1,
    marketWindowContext: {
      regularMarketWindowState: "WITHIN_REGULAR_MARKET_WINDOW",
      holidayCalendarVerified: false,
      claimsMarketOpen: false,
    },
    marketOpenReadinessAcceptance: {
      state: "PASS",
      blockers: [],
      claimsMarketOpen: false,
      holidayCalendarVerified: false,
      productionImpact: "NONE",
      forwardsDownstream: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    },
  }, new Date("2026-09-07T03:48:00.000Z"));

  assert.equal(out.version, "H1_MARKET_OPEN_ACCEPTANCE_CAPTURE_V1");
  assert.equal(out.observedAt, "2026-09-07T03:48:00.000Z");
  assert.equal(out.marketWindowState, "WITHIN_REGULAR_MARKET_WINDOW");
  assert.equal(out.evidence.freshTokenCount, 5);
  assert.equal(out.readiness.consumerReadySymbolCount, 1);
  assert.equal(out.readiness.directionReadySymbolCount, 1);
  assert.equal(out.readiness.shadowInputReadySymbolCount, 1);
  assert.equal(out.acceptance.state, "PASS");
  assert.deepEqual(out.acceptance.blockers, []);
  assert.equal(out.claimsMarketOpen, false);
  assert.equal(out.holidayCalendarVerified, false);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.forwardsDownstream, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});

test("captures blockers without inventing readiness", () => {
  const blockers = ["NO_DIRECTION_READY_SYMBOL", "NO_SHADOW_INPUT_READY_SYMBOL"];
  const out = buildH1MarketOpenAcceptanceCapture({
    asOfDate: "2026-09-07",
    connected: true,
    socketState: "OPEN",
    rawEvidenceExpectedTokenCount: 21,
    rawEvidenceFreshTokenCount: 5,
    rawEvidenceMissingTokenCount: 0,
    rawEvidenceStaleTokenCount: 16,
    readOnlyConsumerReadySymbolCount: 1,
    readOnlyDirectionReadySymbolCount: 0,
    readOnlyShadowInputReadySymbolCount: 0,
    marketWindowContext: {
      regularMarketWindowState: "WITHIN_REGULAR_MARKET_WINDOW",
      holidayCalendarVerified: false,
      claimsMarketOpen: false,
    },
    marketOpenReadinessAcceptance: {
      state: "BLOCKED",
      blockers,
      claimsMarketOpen: false,
      holidayCalendarVerified: false,
      productionImpact: "NONE",
      forwardsDownstream: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    },
  });

  assert.equal(out.acceptance.state, "BLOCKED");
  assert.deepEqual(out.acceptance.blockers, blockers);
  assert.notEqual(out.acceptance.blockers, blockers);
  assert.equal(out.readiness.directionReadySymbolCount, 0);
  assert.equal(out.readiness.shadowInputReadySymbolCount, 0);
});
