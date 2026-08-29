import test from "node:test";
import assert from "node:assert/strict";
import { assessStrategyReadiness } from "../strategy-readiness-engine.js";

const base = {
  regime: "TRENDING_UP" as const,
  probabilityStatus: "READY" as const,
  contractIdentityReady: true,
  dataQualityReady: true,
};

test("fails closed when data quality is not ready", () => {
  const result = assessStrategyReadiness({ ...base, dataQualityReady: false });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "DATA_QUALITY_NOT_READY");
});

test("fails closed when contract identity is unavailable", () => {
  const result = assessStrategyReadiness({ ...base, contractIdentityReady: false });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "CONTRACT_IDENTITY_NOT_READY");
});

test("fails closed when historical support is unavailable", () => {
  const result = assessStrategyReadiness({ ...base, probabilityStatus: "DATA_UNAVAILABLE" });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "HISTORICAL_SUPPORT_UNAVAILABLE");
});

test("unknown and transition regimes stay not ready", () => {
  assert.equal(assessStrategyReadiness({ ...base, regime: "UNKNOWN" }).status, "NOT_READY");
  assert.equal(assessStrategyReadiness({ ...base, regime: "TRANSITION" }).status, "NOT_READY");
});

test("stable validated prerequisites can become research-ready", () => {
  const result = assessStrategyReadiness(base);
  assert.equal(result.status, "READY_FOR_RESEARCH");
});

test("foundation never gains live authority", () => {
  const result = assessStrategyReadiness(base);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
});
