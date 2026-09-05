import test from "node:test";
import assert from "node:assert/strict";
import { classifyBuyerSellerBehaviour, type BuyerSellerEvidence } from "../buyer-seller-behaviour-engine.ts";
import {
  buildBusinessHorizonView,
  evaluateBuyerTelegramEligibility,
  scoreToStars,
} from "../business-buyer-seller-layer.ts";

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

test("business ratings are bounded and ambiguity is translated to WAIT", () => {
  assert.equal(scoreToStars(-10), 1);
  assert.equal(scoreToStars(65), 4);
  assert.equal(scoreToStars(500), 5);
  const view = buildBusinessHorizonView({
    horizon: "INTRADAY",
    buyerScore: 85,
    sellerScore: 25,
    evidenceReady: false,
  });
  assert.equal(view.action, "WAIT");
  assert.equal(view.headline, "No clear edge — wait");
});

test("business edge requires material buyer seller score separation", () => {
  assert.equal(buildBusinessHorizonView({ horizon: "MULTIDAY", buyerScore: 72, sellerScore: 63, evidenceReady: true }).action, "WAIT");
  assert.equal(buildBusinessHorizonView({ horizon: "INTRADAY", buyerScore: 86, sellerScore: 38, evidenceReady: true }).action, "BUYER_EDGE");
  assert.equal(buildBusinessHorizonView({ horizon: "EXPIRY", buyerScore: 35, sellerScore: 88, evidenceReady: true }).action, "SELLER_EDGE");
});

test("buyer-only Telegram gate blocks seller leakage and weak buyer candidates", () => {
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_SELLER", candidateStatus: "READY", qualityStars: 5 }).allowed, false);
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "WATCH", qualityStars: 5 }).allowed, false);
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 3 }).allowed, false);
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 5, devilFlags: ["spread shock"] }).allowed, false);
  assert.deepEqual(
    evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 4 }),
    { allowed: true, reason: "BUYER_READY" },
  );
});
