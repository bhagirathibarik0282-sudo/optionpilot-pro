import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBlackScholes } from "../canonical-option-model.js";
import { liveAdvancedGamma, classifyExpiryDayGreekSemantics, LIVE_ADVANCED_GREEKS_SPEC_VERSION } from "../live-advanced-greeks-spec.js";
import { LIVE_OPTION_MODEL_SPEC } from "../live-option-model-spec.js";

test("positive-DTE live Gamma mirror matches canonical Black-Scholes Gamma across CE/PE matrix", () => {
  let cases = 0;
  for (const spot of [22000,24500]) {
    for (const m of [0.96,1,1.04]) {
      const strike = spot*m;
      for (const dte of [1,2,7,30,45]) {
        for (const ivPct of [10,18,30,50]) {
          const live = liveAdvancedGamma({spot,strike,ivPercent:ivPct,daysToExpiry:dte});
          assert.notEqual(live,null);
          for (const optionType of ["CE","PE"] as const) {
            const canonical = canonicalBlackScholes({
              spot,strike,timeYears:dte/365,
              riskFreeRate:LIVE_OPTION_MODEL_SPEC.riskFreeRate,
              dividendYield:LIVE_OPTION_MODEL_SPEC.dividendYield,
              volatility:ivPct/100,optionType,
            });
            assert.ok(Math.abs(live! - canonical.gamma) < 1e-12);
            cases++;
          }
        }
      }
    }
  }
  console.log(`[Phase39GammaParity] ${JSON.stringify({cases,version:LIVE_ADVANCED_GREEKS_SPEC_VERSION,result:"PASS"})}`);
  assert.equal(cases,240);
});

test("Gamma is side-symmetric under current q=0 Black-Scholes model", () => {
  const input={spot:24500,strike:24600,ivPercent:18,daysToExpiry:7};
  const live=liveAdvancedGamma(input);
  const ce=canonicalBlackScholes({spot:input.spot,strike:input.strike,timeYears:7/365,riskFreeRate:0.10,dividendYield:0,volatility:0.18,optionType:"CE"});
  const pe=canonicalBlackScholes({spot:input.spot,strike:input.strike,timeYears:7/365,riskFreeRate:0.10,dividendYield:0,volatility:0.18,optionType:"PE"});
  assert.ok(Math.abs(ce.gamma-pe.gamma)<1e-12);
  assert.ok(Math.abs(live!-ce.gamma)<1e-12);
});

test("zero DTE is explicitly classified as semantic conflict, not valid parity", () => {
  assert.equal(classifyExpiryDayGreekSemantics(0),"ZERO_DTE_SEMANTIC_CONFLICT");
  const floored=liveAdvancedGamma({spot:24500,strike:24500,ivPercent:18,daysToExpiry:0});
  assert.ok(floored!==null && floored>0);
  assert.throws(()=>canonicalBlackScholes({spot:24500,strike:24500,timeYears:0,riskFreeRate:0.10,dividendYield:0,volatility:0.18,optionType:"CE"}));
});

test("invalid negative DTE remains blocked", () => {
  assert.equal(classifyExpiryDayGreekSemantics(-1),"INVALID_DTE");
  assert.equal(liveAdvancedGamma({spot:24500,strike:24500,ivPercent:18,daysToExpiry:-1}),null);
});
