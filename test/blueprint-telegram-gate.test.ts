import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMessageTrigger } from "../message-trigger-engine.js";

const base = {
  dataFresh: true,
  lifecycle: "WATCH" as const,
  candidateKey: "NIFTY:CE:CURRENT",
  candidateSelectionChanged: false,
  lifecycleChanged: false,
  premiumBehaviourChanged: false,
  buyerSellerStateChanged: false,
  behaviourRiskChanged: false,
  materialEvidenceChange: false,
  footprintLeadershipChanged: false,
  structuralBoundaryChanged: false,
  oppositePremiumStateChanged: false,
  crossDteCoherenceChanged: false,
  breadthStateChanged: false,
  consecutiveConfirmations: 2,
  requiredConfirmations: 2,
  cooldownSatisfied: true,
  currentFingerprint: "NIFTY:CE:CURRENT:v1",
  lastSpokenFingerprint: null as string | null,
};

test("context-only change does not speak without a live meaningful-change flag", () => {
  const result = evaluateMessageTrigger({ ...base });
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.reason, "NO_MEANINGFUL_CHANGE");
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.haikuMayOverride, false);
});

test("confirmed temporal/material change speaks only after confirmation and cooldown", () => {
  const insufficient = evaluateMessageTrigger({
    ...base,
    materialEvidenceChange: true,
    consecutiveConfirmations: 1,
  });
  assert.equal(insufficient.shouldSpeak, false);
  assert.equal(insufficient.reason, "HYSTERESIS_CONFIRMATION_NOT_MET");

  const cooling = evaluateMessageTrigger({
    ...base,
    materialEvidenceChange: true,
    cooldownSatisfied: false,
  });
  assert.equal(cooling.shouldSpeak, false);
  assert.equal(cooling.reason, "COOLDOWN_NOT_SATISFIED");

  const eligible = evaluateMessageTrigger({
    ...base,
    materialEvidenceChange: true,
  });
  assert.equal(eligible.shouldSpeak, true);
  assert.equal(eligible.reason, "MEANINGFUL_CONFIRMED_CHANGE_ELIGIBLE");
});

test("exact repeated Telegram fingerprint is suppressed even after eligibility", () => {
  const result = evaluateMessageTrigger({
    ...base,
    materialEvidenceChange: true,
    lastSpokenFingerprint: base.currentFingerprint,
  });
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.duplicateSuppressed, true);
  assert.equal(result.reason, "EXACT_DUPLICATE_SUPPRESSED");
});
