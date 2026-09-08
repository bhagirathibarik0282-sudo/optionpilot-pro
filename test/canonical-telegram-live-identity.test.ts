import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalBuyerCandidatePacket } from "../canonical-buyer-candidate-packet.ts";
import { consumeCanonicalBusinessPacket } from "../canonical-business-consumer.ts";
import {
  canonicalMeaningfulContractKey,
  evaluateCanonicalTelegramTransport,
} from "../canonical-telegram-transport-gate.ts";
import { meaningfulBridgeFailureDisposition } from "../meaningful-live-telegram.ts";

function consumer() {
  const result = buildCanonicalBuyerCandidatePacket({
    symbol: "NIFTY",
    side: "CE",
    strike: 23650,
    expiryDate: "2026-09-08",
    dte: 0,
    moneyness: "ATM",
    premiumLtp: 100,
    capitalFit: true,
    liquidityOk: true,
    spreadOk: true,
    premiumResponseConfirmed: true,
    deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true,
    multiExpiryConflictAbsent: true,
    currentOrNearExpiryUsable: true,
    higherDteUsable: false,
  });
  assert.ok(result.packet);
  return consumeCanonicalBusinessPacket({
    packet: result.packet,
    telegramQualityStars: 5,
    horizons: [],
  });
}

test("real meaningful-live contract key maps only from the canonical candidate", () => {
  const canonical = consumer();
  const meaningfulKey = canonicalMeaningfulContractKey(canonical);
  assert.equal(meaningfulKey, "NIFTY|2026-09-08|23650|CE");
  const gate = evaluateCanonicalTelegramTransport({
    consumer: canonical,
    meaningfulCandidateKey: meaningfulKey,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, "CANONICAL_BUYER_TRANSPORT_READY");
  assert.equal(gate.candidateKey, canonical.candidateKey);
});

test("same symbol with wrong expiry strike or side fails closed", () => {
  const canonical = consumer();
  for (const meaningfulCandidateKey of [
    "NIFTY|2026-09-15|23650|CE",
    "NIFTY|2026-09-08|23700|CE",
    "NIFTY|2026-09-08|23650|PE",
    "SENSEX|2026-09-08|23650|CE",
  ]) {
    const gate = evaluateCanonicalTelegramTransport({ consumer: canonical, meaningfulCandidateKey });
    assert.equal(gate.allowed, false, meaningfulCandidateKey);
    assert.equal(gate.reason, "CANDIDATE_IDENTITY_MISMATCH", meaningfulCandidateKey);
    assert.equal(gate.failClosed, true);
  }
});

test("missing or quality-blocked canonical authority cannot pass transport", () => {
  const canonical = consumer();
  const meaningfulCandidateKey = canonicalMeaningfulContractKey(canonical);
  assert.equal(evaluateCanonicalTelegramTransport({ consumer: null, meaningfulCandidateKey }).reason, "CANONICAL_CONSUMER_MISSING");
  const blocked = { ...canonical, telegram: { allowed: false, reason: "DEVIL_CHECK_BLOCKED" as const } };
  assert.equal(evaluateCanonicalTelegramTransport({ consumer: blocked, meaningfulCandidateKey }).reason, "BUYER_TELEGRAM_GATE_BLOCKED");
});

test("owned candidate bridge errors fail closed while unrelated messages remain pass-through", () => {
  assert.equal(meaningfulBridgeFailureDisposition(true), "SUPPRESS");
  assert.equal(meaningfulBridgeFailureDisposition(false), "PASS_THROUGH");
});
