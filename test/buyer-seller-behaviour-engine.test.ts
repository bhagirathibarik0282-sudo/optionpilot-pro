import test from "node:test";
import assert from "node:assert/strict";
import { classifyBuyerSellerBehaviour, type BuyerSellerEvidence } from "../buyer-seller-behaviour-engine.ts";

const base: BuyerSellerEvidence = {
  dataFresh: true, contractValid: true,
  buyersInControl: false, sellersInControl: false,
  buyersLosingStrength: false, sellersLosingStrength: false,
  buyingRejected: false, sellingRejected: false,
  shortCovering: false, longUnwinding: false,
};

test("clean buyer control is classified", () => {
  assert.equal(classifyBuyerSellerBehaviour({ ...base, buyersInControl: true }).state, "BUYERS_IN_CONTROL");
});

test("buyer control plus weakening becomes BUYERS_LOSING_STRENGTH", () => {
  assert.equal(classifyBuyerSellerBehaviour({ ...base, buyersInControl: true, buyersLosingStrength: true }).state, "BUYERS_LOSING_STRENGTH");
});

test("rejection and covering states are explicit", () => {
  assert.equal(classifyBuyerSellerBehaviour({ ...base, sellingRejected: true }).state, "SELLING_REJECTED");
  assert.equal(classifyBuyerSellerBehaviour({ ...base, shortCovering: true }).state, "SHORT_COVERING");
});

test("conflicting primary states fail conservative to MARKET_UNDECIDED", () => {
  const r = classifyBuyerSellerBehaviour({ ...base, buyersInControl: true, sellersInControl: true });
  assert.equal(r.state, "MARKET_UNDECIDED");
  assert.ok(r.devilFlags.includes("STATE_CONFLICT"));
});

test("missing stale or invalid evidence fails closed", () => {
  assert.equal(classifyBuyerSellerBehaviour({ ...base, shortCovering: null }).state, "DATA_UNAVAILABLE");
  assert.equal(classifyBuyerSellerBehaviour({ ...base, dataFresh: false }).state, "DATA_UNAVAILABLE");
  assert.equal(classifyBuyerSellerBehaviour({ ...base, contractValid: false }).state, "DATA_UNAVAILABLE");
});

test("engine has no live authority", () => {
  const r = classifyBuyerSellerBehaviour(base);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
