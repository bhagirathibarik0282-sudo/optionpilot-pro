import test from "node:test";
import assert from "node:assert/strict";
import { buildH1LiveDteShadowComparison } from "../h1-live-dte-shadow-comparison-v1.js";
import { publishH1LiveGateEvidence, clearH1LiveSelectorRegistry } from "../h1-live-selector-registry.js";

function packet(dte:number, delta:number, expiryDate:string) {
  const observedAt = "2026-09-07T10:00:00.000Z";
  const gate = (value:boolean) => ({ value, observedAt, source:"TEST", provenance:"LIVE_RUNTIME_EXACT" as const });
  return {
    identity:{symbol:"NIFTY" as const,side:"CE" as const,strike:24000,expiryDate,dte,moneyness:"ATM" as const,premiumLtp:100,observedAt,source:"TEST",provenance:"LIVE_RUNTIME_EXACT" as const},
    gates:{capitalFit:gate(true),liquidityOk:gate(true),spreadOk:gate(true),premiumResponseConfirmed:gate(true),deltaGammaResponseConfirmed:gate(true),thetaIvBurdenAcceptable:gate(true),multiExpiryConflictAbsent:gate(true),currentOrNearExpiryUsable:gate(true),fallbackDteApproved:gate(true)},
    responseMetrics:{premiumMovePct:2,absoluteDeltaChange:delta,currentGamma:0.001,observedAt,source:"TEST",provenance:"LIVE_RUNTIME_EXACT" as const},
  };
}

test("reports contracts recovered by DTE-aware shadow threshold without changing authority", () => {
  clearH1LiveSelectorRegistry();
  publishH1LiveGateEvidence(packet(7,0.023,"2026-09-14"));
  const out = buildH1LiveDteShadowComparison("2026-09-07T10:00:10.000Z");
  assert.equal(out.totalContracts,1);
  assert.equal(out.universalPassCount,0);
  assert.equal(out.shadowPassCount,1);
  assert.equal(out.recoveredByShadowCount,1);
  assert.equal(out.contracts[0].recoveredByShadow,true);
  assert.equal(out.affectsSelector,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.affectsExecution,false);
});
