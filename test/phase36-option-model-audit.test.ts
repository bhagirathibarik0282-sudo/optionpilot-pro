import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalBlackScholes, CANONICAL_OPTION_MODEL_VERSION } from "../canonical-option-model.js";
import { auditLiveOptionModelSource } from "../live-option-model-source-audit.js";

const input = { spot: 24500, strike: 24500, timeYears: 7/365, riskFreeRate: 0.06, dividendYield: 0, volatility: 0.12 } as const;

test("canonical Black-Scholes reference satisfies put-call parity and Greek identities", () => {
  const ce = canonicalBlackScholes({ ...input, optionType: "CE" });
  const pe = canonicalBlackScholes({ ...input, optionType: "PE" });
  const rhs = input.spot * Math.exp(-input.dividendYield * input.timeYears) - input.strike * Math.exp(-input.riskFreeRate * input.timeYears);
  assert.ok(Math.abs((ce.price - pe.price) - rhs) < 0.05);
  assert.ok(Math.abs(ce.gamma - pe.gamma) < 1e-12);
  assert.ok(Math.abs(ce.vegaPerVolPoint - pe.vegaPerVolPoint) < 1e-12);
  assert.ok(Math.abs((ce.delta - pe.delta) - Math.exp(-input.dividendYield * input.timeYears)) < 1e-6);
  assert.equal(CANONICAL_OPTION_MODEL_VERSION, "BS_CONTINUOUS_YIELD_ACT365_V1");
});

test("canonical model rejects invalid time/volatility rather than fabricating Greeks", () => {
  assert.throws(() => canonicalBlackScholes({ ...input, timeYears: 0, optionType: "CE" }));
  assert.throws(() => canonicalBlackScholes({ ...input, volatility: 0, optionType: "CE" }));
});

test("actual current server option-model source is audited without granting permission", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const audit = auditLiveOptionModelSource(server);
  console.log(`[Phase36ModelAudit] ${JSON.stringify(audit)}`);
  assert.ok(["VERIFIED", "PARTIAL", "BLOCKED"].includes(audit.state));
  // Source-marker discovery is not numerical parity proof and therefore cannot
  // by itself enable the Phase-35 model-truth permissions.
  assert.equal(Object.prototype.hasOwnProperty.call(audit, "greekPermission"), false);
});

test("source audit fails closed on incomplete model implementation", () => {
  const audit = auditLiveOptionModelSource("function greek(){ return {delta:0.5,gamma:0.1,vega:1,theta:-1}; }");
  assert.notEqual(audit.state, "VERIFIED");
  assert.ok(audit.reasons.length > 0);
});
