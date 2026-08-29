import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLivePsychologyCoach } from "../live-psychology-coach-contract.ts";

const scalp = {
  style: "SCALP" as const,
  symbol: "NIFTY",
  strike: 24900,
  side: "CE" as const,
  expiryDate: "2026-09-03",
  candidateId: "S17",
};

test("SCALP heading carries style, exact candidate, lifecycle and stable id", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: scalp,
    premiumBehaviour: "RESPONDING_WELL",
    buyerSellerState: "BUYERS_IN_CONTROL",
    lifecycle: "HOLD",
    risks: [],
    dataFresh: true,
    meaningfulChange: true,
    consecutiveConfirmations: 2,
  });
  assert.equal(out.shouldSpeak, true);
  assert.equal(out.scalpPriority, true);
  assert.match(out.heading, /SCALP • NIFTY 24900 CE • HOLD • S17/);
  assert.equal(out.haikuMayDecideTradeState, false);
  assert.equal(out.affectsTelegram, false);
});

test("suppresses repeated commentary when nothing meaningful changed", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: scalp,
    premiumBehaviour: "RESPONDING_WELL",
    buyerSellerState: "BUYERS_IN_CONTROL",
    lifecycle: "HOLD",
    risks: [],
    dataFresh: true,
    meaningfulChange: false,
    consecutiveConfirmations: 5,
  });
  assert.equal(out.shouldSpeak, false);
});

test("hysteresis suppresses one-observation flip noise", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: scalp,
    premiumBehaviour: "OPPOSITE_PREMIUM_WARNING",
    buyerSellerState: "BUYERS_LOSING_STRENGTH",
    lifecycle: "PROTECT",
    risks: ["THESIS_WEAKENING"],
    dataFresh: true,
    meaningfulChange: true,
    consecutiveConfirmations: 1,
  });
  assert.equal(out.shouldSpeak, false);
});

test("EXIT may speak immediately when deterministic exit state is supplied", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: scalp,
    premiumBehaviour: "DIVERGING",
    buyerSellerState: "BUYERS_LOSING_STRENGTH",
    lifecycle: "EXIT",
    risks: ["THESIS_WEAKENING"],
    dataFresh: true,
    meaningfulChange: true,
    consecutiveConfirmations: 1,
  });
  assert.equal(out.shouldSpeak, true);
  assert.equal(out.lifecycle, "EXIT");
});

test("stale or unavailable evidence allows only no-fresh-guidance state", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: scalp,
    premiumBehaviour: "DATA_UNAVAILABLE",
    buyerSellerState: "DATA_UNAVAILABLE",
    lifecycle: "HOLD",
    risks: [],
    dataFresh: false,
    meaningfulChange: true,
    consecutiveConfirmations: 3,
  });
  assert.equal(out.shouldSpeak, true);
  assert.deepEqual(out.risks, ["DATA_UNAVAILABLE"]);
  assert.match(out.reason, /incomplete/i);
});

test("SWING remains separately identified and never inherits SCALP priority", () => {
  const out = evaluateLivePsychologyCoach({
    candidate: { ...scalp, style: "SWING", candidateId: "W04" },
    premiumBehaviour: "RESPONDING_WELL",
    buyerSellerState: "BUYERS_IN_CONTROL",
    lifecycle: "WATCH",
    risks: [],
    dataFresh: true,
    meaningfulChange: true,
    consecutiveConfirmations: 2,
  });
  assert.equal(out.scalpPriority, false);
  assert.match(out.heading, /SWING/);
  assert.match(out.heading, /W04/);
});

test("invalid candidate identity fails closed", () => {
  assert.throws(() => evaluateLivePsychologyCoach({
    candidate: { ...scalp, strike: 0 },
    premiumBehaviour: "RESPONDING_WELL",
    buyerSellerState: "BUYERS_IN_CONTROL",
    lifecycle: "WATCH",
    risks: [],
    dataFresh: true,
    meaningfulChange: true,
    consecutiveConfirmations: 2,
  }), /valid strike/);
});
