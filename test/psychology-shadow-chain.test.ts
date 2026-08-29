import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyCandidateKey, runPsychologyShadowChain } from "../psychology-shadow-chain.ts";

const base = {
  candidate: { style: "SCALP" as const, symbol: "NIFTY", strike: 24900, side: "CE" as const, expiryDate: "2026-09-03", candidateId: "S17" },
  premiumEvidence: {
    dataFresh: true, contractValid: true, liquidityOk: true,
    selectedPremiumDirectionConfirmed: true, responseStrengthConfirmed: true,
    oppositePremiumWarning: false, overextended: false, ivDominant: false,
    thetaPressure: false, diverging: false,
  },
  buyerSellerEvidence: {
    dataFresh: true, contractValid: true,
    buyersInControl: true, sellersInControl: false,
    buyersLosingStrength: false, sellersLosingStrength: false,
    buyingRejected: false, sellingRejected: false,
    shortCovering: false, longUnwinding: false,
  },
  lifecycleInput: {
    currentState: "ACTIVE" as const, event: "THESIS_HOLDING" as const,
    dataFresh: true, contractValid: true, sameCandidate: true, sameStyle: true,
    exitConditionConfirmed: false, partialBookConditionConfirmed: false,
    trailConditionConfirmed: false, protectConditionConfirmed: false,
    entryConditionConfirmed: false, entryActivatedConfirmed: false, thesisHoldingConfirmed: true,
  },
  behaviourRiskEvidence: {
    dataFresh: true, contractValid: true, lateEntryExtended: false,
    earlyExitCondition: false, stopExtensionCondition: false, revengeFlipCondition: false,
    missedMoveFomoCondition: false, averagingLoserCondition: false,
    earlyProfitBookingCondition: false, thesisWeakening: false, noFlipYet: false,
  },
  triggerInput: {
    candidateSelectionChanged: false, lifecycleChanged: true,
    premiumBehaviourChanged: false, buyerSellerStateChanged: false,
    behaviourRiskChanged: false, materialEvidenceChange: false,
    consecutiveConfirmations: 2, requiredConfirmations: 2, cooldownSatisfied: true,
    lastSpokenFingerprint: null,
  },
};

test("complete deterministic chain reaches HOLD and can speak", () => {
  const r = runPsychologyShadowChain(base);
  assert.equal(r.premium.state, "RESPONDING_WELL");
  assert.equal(r.buyerSeller.state, "BUYERS_IN_CONTROL");
  assert.equal(r.lifecycle.nextState, "HOLD");
  assert.equal(r.lifecycle.dataAvailable, true);
  assert.equal(r.trigger.shouldSpeak, true);
  assert.equal(r.coach.shouldSpeak, true);
  assert.equal(r.candidateKey, "SCALP:NIFTY:CE:24900:2026-09-03:S17");
  assert.match(r.currentFingerprint, /^SCALP:NIFTY:CE:24900:2026-09-03:S17:DATA_FRESH:HOLD:/);
  assert.match(r.coach.heading, /SCALP • NIFTY 24900 CE • S17 • HOLD/);
});

test("duplicate message is suppressed end-to-end using internally generated fingerprint", () => {
  const first = runPsychologyShadowChain(base);
  const second = runPsychologyShadowChain({ ...base, triggerInput: { ...base.triggerInput, lastSpokenFingerprint: first.currentFingerprint } });
  assert.equal(second.trigger.shouldSpeak, false);
  assert.equal(second.trigger.reason, "EXACT_DUPLICATE_SUPPRESSED");
  assert.equal(second.coach.shouldSpeak, false);
});

test("stale premium evidence becomes urgent DATA_UNAVAILABLE overlay without lifecycle mutation", () => {
  const r = runPsychologyShadowChain({ ...base, premiumEvidence: { ...base.premiumEvidence, dataFresh: false } });
  assert.equal(r.premium.state, "DATA_UNAVAILABLE");
  assert.equal(r.lifecycle.nextState, "HOLD");
  assert.equal(r.trigger.shouldSpeak, true);
  assert.equal(r.trigger.urgent, true);
  assert.deepEqual(r.coach.risks, ["DATA_UNAVAILABLE"]);
  assert.match(r.currentFingerprint, /DATA_UNAVAILABLE:HOLD/);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});

test("candidate key is style and exact-contract scoped", () => {
  const scalp = buildPsychologyCandidateKey(base.candidate);
  const swing = buildPsychologyCandidateKey({ ...base.candidate, style: "SWING", candidateId: "S17" });
  const otherExpiry = buildPsychologyCandidateKey({ ...base.candidate, expiryDate: "2026-09-10" });
  assert.notEqual(scalp, swing);
  assert.notEqual(scalp, otherExpiry);
});

test("caller cannot inject a spoofed current fingerprint", () => {
  const input = { ...base, triggerInput: { ...base.triggerInput, currentFingerprint: "W04:HOLD" } } as unknown as typeof base;
  const r = runPsychologyShadowChain(input);
  assert.equal(r.candidateKey, "SCALP:NIFTY:CE:24900:2026-09-03:S17");
  assert.ok(r.currentFingerprint.startsWith(`${r.candidateKey}:`));
});

test("Haiku/coach cannot override trigger suppression", () => {
  const r = runPsychologyShadowChain({ ...base, triggerInput: { ...base.triggerInput, cooldownSatisfied: false } });
  assert.equal(r.trigger.shouldSpeak, false);
  assert.equal(r.coach.shouldSpeak, false);
  assert.equal(r.coach.haikuMayDecideTradeState, false);
});
