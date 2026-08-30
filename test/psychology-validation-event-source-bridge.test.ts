import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateIdentity } from "../live-psychology-coach-contract.ts";
import type { PsychologyShadowChainResult } from "../psychology-shadow-chain.ts";
import { buildPsychologyCandidateKey } from "../psychology-shadow-chain.ts";
import { projectPsychologyValidationEvents } from "../psychology-validation-event-source-bridge.ts";

const candidate: CandidateIdentity = {
  style: "SCALP",
  symbol: "NIFTY",
  strike: 25000,
  side: "CE",
  expiryDate: "2026-08-20",
  candidateId: "T1",
};

function chain(input: {
  premium?: string;
  buyerSeller?: string;
  lifecycle?: string;
  eligible?: boolean;
  duplicate?: boolean;
  shouldSpeak?: boolean;
  risks?: string[];
  candidateKey?: string;
} = {}): PsychologyShadowChainResult {
  const lifecycle = input.lifecycle ?? "HOLD";
  return {
    candidateKey: input.candidateKey ?? buildPsychologyCandidateKey(candidate),
    premium: { state: input.premium ?? "RESPONDING_WELL" },
    buyerSeller: { state: input.buyerSeller ?? "BUYERS_IN_CONTROL" },
    lifecycle: { nextState: lifecycle },
    behaviourRisk: { risks: input.risks ?? [] },
    trigger: {
      eligibleBeforeDuplicateSuppression: input.eligible ?? false,
      duplicateSuppressed: input.duplicate ?? false,
      shouldSpeak: input.shouldSpeak ?? false,
    },
  } as unknown as PsychologyShadowChainResult;
}

const base = {
  candidate,
  tradeId: "T1",
  observedAt: "2026-08-20T09:30:00+05:30",
  source: "DETERMINISTIC_REPLAY" as const,
  ruleVersion: "PSY_SOURCE_BRIDGE_V1",
};

test("projects directly provable state, message, entry and completion events", () => {
  const previous = chain({ premium: "WEAK_RESPONSE", buyerSeller: "MARKET_UNDECIDED", lifecycle: "ENTRY_READY" });
  const current = chain({
    premium: "RESPONDING_WELL",
    buyerSeller: "BUYERS_IN_CONTROL",
    lifecycle: "ACTIVE",
    eligible: true,
    shouldSpeak: true,
    risks: ["DO_NOT_CHASE"],
  });

  const result = projectPsychologyValidationEvents({ ...base, previous, current });
  assert.equal(result.status, "READY");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.events.filter((e) => e.kind === "STATE_FLIP").length, 3);
  const message = result.events.find((e) => e.kind === "MESSAGE_ELIGIBLE");
  assert.ok(message && message.kind === "MESSAGE_ELIGIBLE");
  assert.equal(message.duplicate, false);
  assert.equal(message.spoken, true);
  const entry = result.events.find((e) => e.kind === "ENTRY");
  assert.ok(entry && entry.kind === "ENTRY");
  assert.equal(entry.accepted, true);
  assert.equal(entry.extensionBlocked, true);
  assert.equal(result.events.some((e) => e.kind === "CHASE_WARNING"), false);
});

test("duplicate trigger instrumentation becomes a denominator event without spoken update", () => {
  const result = projectPsychologyValidationEvents({
    ...base,
    previous: chain(),
    current: chain({ eligible: true, duplicate: true, shouldSpeak: false }),
  });
  assert.equal(result.status, "READY");
  const message = result.events.find((e) => e.kind === "MESSAGE_ELIGIBLE");
  assert.ok(message && message.kind === "MESSAGE_ELIGIBLE");
  assert.equal(message.duplicate, true);
  assert.equal(message.spoken, false);
});

test("non-eligible trigger does not fabricate a message denominator event", () => {
  const result = projectPsychologyValidationEvents({ ...base, previous: chain(), current: chain() });
  assert.equal(result.status, "READY");
  assert.equal(result.events.some((e) => e.kind === "MESSAGE_ELIGIBLE"), false);
});

test("terminal lifecycle transition emits terminal flip and trade completion", () => {
  const result = projectPsychologyValidationEvents({
    ...base,
    previous: chain({ lifecycle: "TRAIL" }),
    current: chain({ lifecycle: "EXIT", eligible: true, shouldSpeak: true }),
  });
  assert.equal(result.status, "READY");
  const lifecycleFlip = result.events.find((e) => e.kind === "STATE_FLIP");
  assert.ok(lifecycleFlip && lifecycleFlip.kind === "STATE_FLIP");
  assert.equal(lifecycleFlip.terminal, true);
  assert.equal(result.events.some((e) => e.kind === "TRADE_COMPLETED"), true);
});

test("candidate/trade identity mismatch fails closed", () => {
  const result = projectPsychologyValidationEvents({
    ...base,
    tradeId: "T2",
    previous: null,
    current: chain(),
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.events.length, 0);
  assert.ok(result.blockers.includes("TRADE_ID_CANDIDATE_ID_MISMATCH"));
});

test("cross-candidate previous snapshot fails closed", () => {
  const result = projectPsychologyValidationEvents({
    ...base,
    previous: chain({ candidateKey: "SCALP:NIFTY:PE:25000:2026-08-20:T1" }),
    current: chain(),
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("PREVIOUS_CANDIDATE_KEY_MISMATCH"));
});
