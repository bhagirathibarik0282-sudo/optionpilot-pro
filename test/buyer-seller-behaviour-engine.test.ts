import test from "node:test";
import assert from "node:assert/strict";
import { classifyBuyerSellerBehaviour, type BuyerSellerEvidence } from "../buyer-seller-behaviour-engine.ts";
import {
  buildBusinessHorizonView,
  evaluateBuyerTelegramEligibility,
  scoreToStars,
} from "../business-buyer-seller-layer.ts";
import { buildCanonicalBuyerCandidatePacket } from "../canonical-buyer-candidate-packet.ts";
import { consumeCanonicalBusinessPacket } from "../canonical-business-consumer.ts";
import { evaluateCanonicalTelegramTransport } from "../canonical-telegram-transport-gate.ts";

const base: BuyerSellerEvidence = {
  dataFresh: true, contractValid: true,
  buyersInControl: false, sellersInControl: false,
  buyersLosingStrength: false, sellersLosingStrength: false,
  buyingRejected: false, sellingRejected: false,
  shortCovering: false, longUnwinding: false,
};

const buyerCandidateBase = {
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 25000,
  expiryDate: "2026-09-08",
  dte: 2,
  moneyness: "ATM" as const,
  premiumLtp: 150,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
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

test("canonical packet preserves hard selector authority and candidate key", () => {
  const result = buildCanonicalBuyerCandidatePacket(buyerCandidateBase);
  assert.equal(result.decision, "READY");
  assert.ok(result.packet);
  assert.equal(result.selector.decision, "SELECT");
  assert.equal(result.packet?.candidateKey, result.selector.candidateKey);
  assert.equal(result.packet?.sourceAuthority, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.equal(result.packet?.role, "OPTION_BUYER");
  assert.equal(result.packet?.affectsTelegram, false);
  assert.equal(result.packet?.affectsExecution, false);
  assert.equal(result.packet?.aiMayOverride, false);
});

test("PE remains an option buyer contract and is never remapped to seller role", () => {
  const result = buildCanonicalBuyerCandidatePacket({ ...buyerCandidateBase, side: "PE" });
  assert.equal(result.decision, "READY");
  assert.equal(result.packet?.optionSide, "PE");
  assert.equal(result.packet?.role, "OPTION_BUYER");
  assert.match(result.packet?.candidateKey ?? "", /:PE:/);
});

test("hard selector BLOCK cannot create a canonical buyer packet", () => {
  const result = buildCanonicalBuyerCandidatePacket({ ...buyerCandidateBase, spreadOk: false });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.packet, null);
  assert.equal(result.selector.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("SPREAD_GATE_FAILED"));
  assert.equal(result.failClosed, true);
});

test("canonical consumer gives dashboard and Telegram the same candidate", () => {
  const canonical = buildCanonicalBuyerCandidatePacket({ ...buyerCandidateBase, side: "PE" });
  assert.ok(canonical.packet);
  const result = consumeCanonicalBusinessPacket({
    packet: canonical.packet,
    telegramQualityStars: 5,
    horizons: [
      { horizon: "INTRADAY", buyerScore: 88, sellerScore: 32, evidenceReady: true },
      { horizon: "MULTIDAY", buyerScore: 70, sellerScore: 62, evidenceReady: true },
      { horizon: "EXPIRY", buyerScore: 84, sellerScore: 40, evidenceReady: true },
    ],
  });
  assert.equal(result.buyerCandidate?.candidateKey, canonical.packet?.candidateKey);
  assert.equal(result.candidateKey, canonical.packet?.candidateKey);
  assert.equal(result.buyerCandidate?.optionSide, "PE");
  assert.equal(result.buyerCandidate?.role, "OPTION_BUYER");
  assert.equal(result.telegram.allowed, true);
  assert.equal(result.sameCanonicalCandidateForDashboardAndTelegram, true);
  assert.equal(result.horizons[1]?.action, "WAIT");
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
  assert.equal(result.aiMayOverride, false);
});

test("canonical consumer fails closed when packet is absent", () => {
  const result = consumeCanonicalBusinessPacket({
    packet: null,
    telegramQualityStars: 5,
    horizons: [{ horizon: "INTRADAY", buyerScore: 95, sellerScore: 10, evidenceReady: true }],
  });
  assert.equal(result.buyerCandidate, null);
  assert.equal(result.candidateKey, null);
  assert.deepEqual(result.telegram, { allowed: false, reason: "CANDIDATE_NOT_READY" });
});

test("canonical consumer blocks Telegram on quality or devil flags without changing dashboard identity", () => {
  const canonical = buildCanonicalBuyerCandidatePacket(buyerCandidateBase);
  assert.ok(canonical.packet);
  const weak = consumeCanonicalBusinessPacket({
    packet: canonical.packet,
    telegramQualityStars: 3,
    horizons: [],
  });
  const devil = consumeCanonicalBusinessPacket({
    packet: canonical.packet,
    telegramQualityStars: 5,
    devilFlags: ["spread shock"],
    horizons: [],
  });
  assert.equal(weak.telegram.reason, "QUALITY_BELOW_GATE");
  assert.equal(devil.telegram.reason, "DEVIL_CHECK_BLOCKED");
  assert.equal(weak.buyerCandidate?.candidateKey, canonical.packet?.candidateKey);
  assert.equal(devil.buyerCandidate?.candidateKey, canonical.packet?.candidateKey);
});

test("canonical Telegram transport passes only the exact approved buyer candidate", () => {
  const canonical = buildCanonicalBuyerCandidatePacket({ ...buyerCandidateBase, side: "PE" });
  assert.ok(canonical.packet);
  const consumer = consumeCanonicalBusinessPacket({ packet: canonical.packet, telegramQualityStars: 5, horizons: [] });
  const result = evaluateCanonicalTelegramTransport({ consumer, meaningfulCandidateKey: canonical.packet!.candidateKey });
  assert.deepEqual(result, {
    allowed: true,
    reason: "CANONICAL_BUYER_TRANSPORT_READY",
    candidateKey: canonical.packet!.candidateKey,
    failClosed: true,
  });
});

test("canonical Telegram transport fails closed on missing consumer or candidate identity", () => {
  const missing = evaluateCanonicalTelegramTransport({ consumer: null, meaningfulCandidateKey: "anything" });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, "CANONICAL_CONSUMER_MISSING");

  const canonical = buildCanonicalBuyerCandidatePacket(buyerCandidateBase);
  assert.ok(canonical.packet);
  const consumer = consumeCanonicalBusinessPacket({ packet: canonical.packet, telegramQualityStars: 5, horizons: [] });
  const noKey = evaluateCanonicalTelegramTransport({ consumer, meaningfulCandidateKey: null });
  const mismatch = evaluateCanonicalTelegramTransport({ consumer, meaningfulCandidateKey: "NIFTY:PE:99999:2099-01-01:DTE0:ATM" });
  assert.equal(noKey.reason, "MEANINGFUL_CANDIDATE_MISSING");
  assert.equal(mismatch.reason, "CANDIDATE_IDENTITY_MISMATCH");
  assert.equal(noKey.failClosed, true);
  assert.equal(mismatch.failClosed, true);
});

test("canonical Telegram transport respects buyer quality and devil gate blocks", () => {
  const canonical = buildCanonicalBuyerCandidatePacket(buyerCandidateBase);
  assert.ok(canonical.packet);
  const weak = consumeCanonicalBusinessPacket({ packet: canonical.packet, telegramQualityStars: 3, horizons: [] });
  const devil = consumeCanonicalBusinessPacket({ packet: canonical.packet, telegramQualityStars: 5, devilFlags: ["spread shock"], horizons: [] });
  assert.equal(evaluateCanonicalTelegramTransport({ consumer: weak, meaningfulCandidateKey: canonical.packet!.candidateKey }).reason, "BUYER_TELEGRAM_GATE_BLOCKED");
  assert.equal(evaluateCanonicalTelegramTransport({ consumer: devil, meaningfulCandidateKey: canonical.packet!.candidateKey }).reason, "BUYER_TELEGRAM_GATE_BLOCKED");
});
