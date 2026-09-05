import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBusinessHorizonView,
  evaluateBuyerTelegramEligibility,
  scoreToStars,
} from "../business-buyer-seller-layer.js";

test("scoreToStars clamps presentation scores to 1..5", () => {
  assert.equal(scoreToStars(null), 1);
  assert.equal(scoreToStars(-20), 1);
  assert.equal(scoreToStars(65), 4);
  assert.equal(scoreToStars(1000), 5);
});

test("unclear or unavailable evidence becomes WAIT instead of research jargon", () => {
  const view = buildBusinessHorizonView({
    horizon: "INTRADAY",
    buyerScore: 80,
    sellerScore: 20,
    evidenceReady: false,
    reasons: ["fresh deterministic evidence not ready"],
  });
  assert.equal(view.action, "WAIT");
  assert.equal(view.headline, "No clear edge — wait");
});

test("small buyer seller separation stays WAIT", () => {
  const view = buildBusinessHorizonView({
    horizon: "MULTIDAY",
    buyerScore: 72,
    sellerScore: 63,
    evidenceReady: true,
  });
  assert.equal(view.action, "WAIT");
});

test("clear buyer and seller edges remain separate business views", () => {
  const buyer = buildBusinessHorizonView({
    horizon: "INTRADAY",
    buyerScore: 86,
    sellerScore: 38,
    evidenceReady: true,
  });
  const seller = buildBusinessHorizonView({
    horizon: "EXPIRY",
    buyerScore: 35,
    sellerScore: 88,
    evidenceReady: true,
  });
  assert.equal(buyer.action, "BUYER_EDGE");
  assert.equal(seller.action, "SELLER_EDGE");
});

test("seller role can never leak to Telegram", () => {
  const gate = evaluateBuyerTelegramEligibility({
    role: "OPTION_SELLER",
    candidateStatus: "READY",
    qualityStars: 5,
  });
  assert.deepEqual(gate, { allowed: false, reason: "SELLER_ROLE_BLOCKED" });
});

test("buyer Telegram requires READY, >=4 stars and clean devil check", () => {
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "WATCH", qualityStars: 5 }).allowed, false);
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 3 }).allowed, false);
  assert.equal(evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 5, devilFlags: ["spread shock"] }).allowed, false);
  assert.deepEqual(
    evaluateBuyerTelegramEligibility({ role: "OPTION_BUYER", candidateStatus: "READY", qualityStars: 4 }),
    { allowed: true, reason: "BUYER_READY" },
  );
});
