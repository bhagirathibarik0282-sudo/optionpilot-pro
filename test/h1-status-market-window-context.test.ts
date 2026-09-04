import test from "node:test";
import assert from "node:assert/strict";
import {
  getH1DynamicReadOnlyServerStatus,
  resetH1DynamicReadOnlyServerBootstrapForTest,
} from "../h1-dynamic-readonly-server-bootstrap.js";

process.env.NODE_ENV = "test";

test("read-only H1 status surfaces regular market window context without authority", () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const out = getH1DynamicReadOnlyServerStatus();

  assert.equal(out.marketWindowContext.version, "H1_REGULAR_MARKET_WINDOW_CONTEXT_V1");
  assert.equal(out.marketWindowContext.timezone, "Asia/Kolkata");
  assert.equal(out.marketWindowContext.regularWindowStart, "09:15");
  assert.equal(out.marketWindowContext.regularWindowEnd, "15:30");
  assert.equal(out.marketWindowContext.claimsMarketOpen, false);
  assert.equal(out.marketWindowContext.holidayCalendarVerified, false);
  assert.equal(out.marketWindowContext.productionImpact, "NONE");
  assert.equal(out.marketWindowContext.affectsVerdict, false);
  assert.equal(out.marketWindowContext.affectsExecution, false);
  assert.equal(out.marketWindowContext.affectsTelegram, false);
  assert.equal(out.marketWindowContext.failClosed, true);
});

test("market-window context does not change readiness or downstream authority", () => {
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
