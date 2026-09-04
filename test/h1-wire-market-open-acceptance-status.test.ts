import test from "node:test";
import assert from "node:assert/strict";
import {
  getH1DynamicReadOnlyServerStatus,
  resetH1DynamicReadOnlyServerBootstrapForTest,
} from "../h1-dynamic-readonly-server-bootstrap.js";

process.env.NODE_ENV = "test";

test("read-only status exposes market-open readiness acceptance without authority", () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const out = getH1DynamicReadOnlyServerStatus();

  assert.equal(out.marketOpenReadinessAcceptance.version, "H1_MARKET_OPEN_READINESS_ACCEPTANCE_V1");
  assert.equal(out.marketOpenReadinessAcceptance.claimsMarketOpen, false);
  assert.equal(out.marketOpenReadinessAcceptance.holidayCalendarVerified, false);
  assert.equal(out.marketOpenReadinessAcceptance.productionImpact, "NONE");
  assert.equal(out.marketOpenReadinessAcceptance.forwardsDownstream, false);
  assert.equal(out.marketOpenReadinessAcceptance.affectsVerdict, false);
  assert.equal(out.marketOpenReadinessAcceptance.affectsExecution, false);
  assert.equal(out.marketOpenReadinessAcceptance.affectsTelegram, false);
  assert.equal(out.marketOpenReadinessAcceptance.failClosed, true);
});

test("acceptance exposure does not alter readiness or downstream authority", () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const out = getH1DynamicReadOnlyServerStatus();

  assert.equal(out.rawEvidenceReady, false);
  assert.equal(out.rawEvidenceFreshTokenCount, 0);
  assert.equal(out.readOnlyConsumerReadySymbolCount, 0);
  assert.equal(out.readOnlyDirectionReadySymbolCount, 0);
  assert.equal(out.readOnlyShadowInputReadySymbolCount, 0);
  assert.equal(out.forwardsDownstream, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});
