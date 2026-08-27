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
  const evidence = server.split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter((x) => /(implied\s*vol|impliedVol|black.?scholes|risk.?free|dividend|yield|time.?to.?expiry|years.?to.?expiry|\bd1\b|\bd2\b|gamma|vega|theta)/i.test(x.text))
    .filter((x) => x.text.length > 0 && x.text.length < 260)
    .slice(0, 40);
  console.log(`[Phase36SourceEvidence] ${JSON.stringify(evidence)}`);
  assert.ok(["VERIFIED", "PARTIAL", "BLOCKED"].includes(audit.state));
  assert.equal(Object.prototype.hasOwnProperty.call(audit, "greekPermission"), false);
});

test("source audit fails closed on incomplete model implementation", () => {
  const audit = auditLiveOptionModelSource("function greek(){ return {delta:0.5,gamma:0.1,vega:1,theta:-1}; }");
  assert.notEqual(audit.state, "VERIFIED");
  assert.ok(audit.reasons.length > 0);
});
