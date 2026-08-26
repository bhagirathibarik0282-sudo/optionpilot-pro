import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBlackScholes } from "../canonical-option-model.js";
import { liveBsPrice, liveCalcGreeks, liveCalcIv, LIVE_OPTION_MODEL_SPEC } from "../live-option-model-spec.js";
import { classifyIvSolverConditioning, PARITY_TEST_MIN_VEGA_PER_VOL_POINT } from "../iv-solver-conditioning.js";

const spots = [22000, 24500];
const moneyness = [0.96, 1.0, 1.04];
const dtes = [1, 7, 30, 45];
const vols = [0.10, 0.18, 0.30];

function near(a:number,b:number,tol:number,msg:string){ assert.ok(Math.abs(a-b)<=tol, `${msg}: ${a} vs ${b}`); }

test("audited live Black-Scholes formulas match canonical reference and IV recovery is conditioned", () => {
  let cases=0, ivRecoverable=0, illConditioned=0;
  for (const spot of spots) for (const m of moneyness) for (const dte of dtes) for (const vol of vols) for (const optionType of ["CE","PE"] as const) {
    const strike = Math.round((spot*m)/50)*50;
    const T=dte/365;
    const isCall=optionType==="CE";
    const canonical=canonicalBlackScholes({spot,strike,timeYears:T,riskFreeRate:LIVE_OPTION_MODEL_SPEC.riskFreeRate,dividendYield:0,volatility:vol,optionType});
    const livePrice=liveBsPrice(spot,strike,vol,T,isCall);
    const liveGreeks=liveCalcGreeks(spot,strike,vol*100,dte,isCall);
    near(livePrice,canonical.price,1e-9,"price parity");
    near(liveGreeks.delta,canonical.delta,1e-9,"delta parity");
    near(liveGreeks.vega,canonical.vegaPerVolPoint,1e-9,"vega parity");
    near(liveGreeks.theta,canonical.thetaPerDay,1e-9,"theta parity");

    // IV inversion is not uniformly well-conditioned. The 0.01 premium/IV-point
    // vega floor is a parity-test research guard only, not a production threshold.
    const conditioning=classifyIvSolverConditioning({spot,strike,volatilityPct:vol*100,daysToExpiry:dte,isCall});
    if (conditioning.state === "WELL_CONDITIONED") {
      const recovered=liveCalcIv(canonical.price,spot,strike,dte,isCall)/100;
      near(recovered,vol,2e-6,"IV recovery");
      ivRecoverable++;
    } else {
      assert.equal(conditioning.state,"ILL_CONDITIONED_LOW_VEGA");
      illConditioned++;
    }
    cases++;
  }
  assert.ok(ivRecoverable>0);
  assert.ok(illConditioned>0, "matrix must exercise at least one low-vega unstable case");
  console.log(`[Phase37Parity] ${JSON.stringify({cases,ivRecoverable,illConditioned,minVegaPerVolPoint:PARITY_TEST_MIN_VEGA_PER_VOL_POINT,riskFreeRate:LIVE_OPTION_MODEL_SPEC.riskFreeRate,dividendYield:0,dayCount:"ACT_365",solver:"BISECTION_60",formulaParity:"PASS"})}`);
});

test("known near-expiry low-vega contract is explicitly ill-conditioned instead of forcing IV parity", () => {
  const result=classifyIvSolverConditioning({spot:22000,strike:21100,volatilityPct:10,daysToExpiry:1,isCall:true});
  assert.equal(result.state,"ILL_CONDITIONED_LOW_VEGA");
});

test("live model specification remains fail-closed on invalid IV inputs", () => {
  assert.equal(liveCalcIv(0,24500,24500,7,true),0);
  assert.deepEqual(liveCalcGreeks(24500,24500,0,7,true),{vega:0,theta:0,delta:0});
  assert.equal(classifyIvSolverConditioning({spot:0,strike:24500,volatilityPct:10,daysToExpiry:7,isCall:true}).state,"INVALID_INPUT");
});
