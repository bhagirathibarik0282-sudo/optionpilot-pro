import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMessageTrigger, type MessageTriggerInput } from "../message-trigger-engine.ts";

const base: MessageTriggerInput = {
  dataFresh: true,
  lifecycle: "HOLD",
  candidateSelected: false,
  lifecycleChanged: false,
  premiumBehaviourChanged: false,
  buyerSellerStateChanged: false,
  behaviourRiskChanged: false,
  materialEvidenceChange: false,
  consecutiveConfirmations: 2,
  requiredConfirmations: 2,
  cooldownSatisfied: true,
  currentFingerprint: "S17:HOLD:RESPONDING_WELL",
  lastSpokenFingerprint: null,
};

test("no meaningful change is suppressed", () => {
  const r = evaluateMessageTrigger(base);
  assert.equal(r.shouldSpeak, false);
});

test("meaningful confirmed change is eligible", () => {
  const r = evaluateMessageTrigger({ ...base, premiumBehaviourChanged: true });
  assert.equal(r.shouldSpeak, true);
  assert.equal(r.urgent, false);
});

test("hysteresis blocks under-confirmed change", () => {
  const r = evaluateMessageTrigger({ ...base, lifecycleChanged: true, consecutiveConfirmations: 1 });
  assert.equal(r.shouldSpeak, false);
  assert.equal(r.reason, "HYSTERESIS_CONFIRMATION_NOT_MET");
});

test("cooldown blocks non-urgent repeated commentary", () => {
  const r = evaluateMessageTrigger({ ...base, behaviourRiskChanged: true, cooldownSatisfied: false });
  assert.equal(r.shouldSpeak, false);
  assert.equal(r.reason, "COOLDOWN_NOT_SATISFIED");
});

test("exact duplicate is always suppressed, including urgent states", () => {
  const r = evaluateMessageTrigger({
    ...base,
    lifecycle: "EXIT",
    currentFingerprint: "S17:EXIT",
    lastSpokenFingerprint: "S17:EXIT",
  });
  assert.equal(r.shouldSpeak, false);
  assert.equal(r.reason, "EXACT_DUPLICATE_SUPPRESSED");
});

test("fresh unique EXIT is urgent and bypasses hysteresis/cooldown", () => {
  const r = evaluateMessageTrigger({
    ...base,
    lifecycle: "EXIT",
    consecutiveConfirmations: 0,
    cooldownSatisfied: false,
    currentFingerprint: "S17:EXIT",
  });
  assert.equal(r.shouldSpeak, true);
  assert.equal(r.urgent, true);
});

test("DATA_UNAVAILABLE is urgent but cannot repeat exact duplicate", () => {
  const fresh = evaluateMessageTrigger({
    ...base,
    dataFresh: false,
    lifecycle: "DATA_UNAVAILABLE",
    currentFingerprint: "S17:DATA_UNAVAILABLE",
  });
  assert.equal(fresh.shouldSpeak, true);
  assert.equal(fresh.urgent, true);

  const duplicate = evaluateMessageTrigger({
    ...base,
    dataFresh: false,
    lifecycle: "DATA_UNAVAILABLE",
    currentFingerprint: "S17:DATA_UNAVAILABLE",
    lastSpokenFingerprint: "S17:DATA_UNAVAILABLE",
  });
  assert.equal(duplicate.shouldSpeak, false);
});

test("invalid confirmation policy fails closed", () => {
  const r = evaluateMessageTrigger({ ...base, lifecycleChanged: true, requiredConfirmations: 0 });
  assert.equal(r.shouldSpeak, false);
  assert.equal(r.reason, "INVALID_REQUIRED_CONFIRMATIONS_POLICY");
});

test("Haiku can never override trigger result", () => {
  const r = evaluateMessageTrigger({ ...base, candidateSelected: true });
  assert.equal(r.haikuMayOverride, false);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
