import test from "node:test";
import assert from "node:assert/strict";
import { createShadowTradeEvidence } from "../shadow-trade-evidence-recorder.js";
import { bindLiveTickToShadowTrade, validateShadowContractIdentity } from "../live-shadow-market-binding.js";

const evidence = createShadowTradeEvidence({
  tradeId: "BIND-1",
  ts: "2026-09-01T09:30:00+05:30",
  index: "NIFTY",
  entryPremium: 120,
  entryQty: 130,
  initialTrailingSl: 112,
})!;

const identity = {
  index: "NIFTY" as const,
  optionType: "CE" as const,
  strike: 25000,
  expiry: "2026-09-03",
  instrumentToken: "12345",
};

const tick = {
  ts: "2026-09-01T09:33:00+05:30",
  index: "NIFTY" as const,
  optionType: "CE" as const,
  strike: 25000,
  expiry: "2026-09-03",
  premium: 128,
  instrumentToken: "12345",
};

test("accepts valid exact contract identity", () => {
  assert.equal(validateShadowContractIdentity(identity), true);
  const b = bindLiveTickToShadowTrade(evidence, identity, tick);
  assert.ok(b);
  assert.equal(b?.exactContractMatch, true);
  assert.equal(b?.brokerOrderAllowed, false);
});

test("rejects wrong strike", () => {
  assert.equal(bindLiveTickToShadowTrade(evidence, identity, { ...tick, strike: 25100 }), null);
});

test("rejects wrong expiry", () => {
  assert.equal(bindLiveTickToShadowTrade(evidence, identity, { ...tick, expiry: "2026-09-10" }), null);
});

test("rejects wrong option side", () => {
  assert.equal(bindLiveTickToShadowTrade(evidence, identity, { ...tick, optionType: "PE" }), null);
});

test("rejects token mismatch when token is pinned", () => {
  assert.equal(bindLiveTickToShadowTrade(evidence, identity, { ...tick, instrumentToken: "99999" }), null);
});

test("rejects cross-index tick", () => {
  assert.equal(bindLiveTickToShadowTrade(evidence, identity, { ...tick, index: "SENSEX" }), null);
});

test("rejects invalid expiry identity", () => {
  assert.equal(validateShadowContractIdentity({ ...identity, expiry: "bad-date" }), false);
});

test("rejects closed evidence", () => {
  assert.equal(bindLiveTickToShadowTrade({ ...evidence, closed: true }, identity, tick), null);
});
