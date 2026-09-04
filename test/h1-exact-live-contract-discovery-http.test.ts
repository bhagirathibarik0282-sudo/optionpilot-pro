import assert from "node:assert/strict";
import test from "node:test";
import { runH1ExactLiveContractDiscoveryHttp } from "../h1-exact-live-contract-discovery-http.js";

test("invalid date fails closed before any authority access", async () => {
  const out = await runH1ExactLiveContractDiscoveryHttp({ symbols: "NIFTY", asOfDate: "bad-date" });
  assert.equal(out.ok, false);
  assert.deepEqual(out.blockers, ["DISCOVERY_AS_OF_DATE_INVALID"]);
  assert.deepEqual(out.rows, []);
});

test("invalid symbol fails closed before any authority access", async () => {
  const out = await runH1ExactLiveContractDiscoveryHttp({ symbols: "NIFTY,FAKE", asOfDate: "2026-09-04" });
  assert.equal(out.ok, false);
  assert.deepEqual(out.blockers, ["DISCOVERY_SYMBOL_INVALID"]);
  assert.deepEqual(out.rows, []);
});
