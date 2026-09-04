import test from "node:test";
import assert from "node:assert/strict";
import { startH1DynamicReadOnlyLiveChain } from "../h1-dynamic-readonly-live-chain.js";

test("explicitly disabled chain returns without starting live market wiring", async () => {
  const out=await startH1DynamicReadOnlyLiveChain("2026-09-04",false);
  assert.equal(out.started,false);
  assert.equal(out.reason,"DISABLED");
  assert.equal(out.subscribedTokenCount,0);
  assert.equal(out.service,null);
  assert.equal(out.readOnly,true);
  assert.equal(out.affectsVerdict,false);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.productionImpact,"NONE");
  assert.equal(out.failClosed,true);
});
