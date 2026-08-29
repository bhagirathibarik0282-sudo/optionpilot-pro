import test from "node:test";
import assert from "node:assert/strict";
import { advanceTradeLifecycle, type TradeLifecycleInput } from "../trade-lifecycle-engine.ts";

const base: TradeLifecycleInput = {
  currentState: "WATCH",
  event: "CANDIDATE_VALID",
  dataFresh: true,
  contractValid: true,
  sameCandidate: true,
  sameStyle: true,
  exitConditionConfirmed: false,
  partialBookConditionConfirmed: false,
  trailConditionConfirmed: false,
  protectConditionConfirmed: false,
  entryConditionConfirmed: false,
  entryActivatedConfirmed: false,
  thesisHoldingConfirmed: false,
};

test("WATCH moves to ENTRY_READY only with explicit confirmation", () => {
  const r = advanceTradeLifecycle({ ...base, event: "ENTRY_CONDITIONS_READY", entryConditionConfirmed: true });
  assert.equal(r.nextState, "ENTRY_READY");
});

test("ENTRY_READY moves to ACTIVE only on confirmed activation", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "ENTRY_READY", event: "ENTRY_ACTIVATED", entryActivatedConfirmed: true });
  assert.equal(r.nextState, "ACTIVE");
});

test("ACTIVE moves to HOLD only when thesis remains confirmed", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "ACTIVE", event: "THESIS_HOLDING", thesisHoldingConfirmed: true });
  assert.equal(r.nextState, "HOLD");
});

test("HOLD can move to PROTECT", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "PROFIT_PROTECTION_REQUIRED", protectConditionConfirmed: true });
  assert.equal(r.nextState, "PROTECT");
});

test("partial booking requires explicit deterministic confirmation", () => {
  const blocked = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "PARTIAL_BOOK_TRIGGERED" });
  assert.equal(blocked.nextState, "HOLD");
  const allowed = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "PARTIAL_BOOK_TRIGGERED", partialBookConditionConfirmed: true });
  assert.equal(allowed.nextState, "PARTIAL_BOOK");
});

test("TRAIL requires explicit confirmation", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "PARTIAL_BOOK", event: "TRAIL_TRIGGERED", trailConditionConfirmed: true });
  assert.equal(r.nextState, "TRAIL");
});

test("confirmed EXIT can happen immediately and becomes terminal", () => {
  const exited = advanceTradeLifecycle({ ...base, currentState: "ACTIVE", event: "EXIT_TRIGGERED", exitConditionConfirmed: true });
  assert.equal(exited.nextState, "EXIT");
  const again = advanceTradeLifecycle({ ...base, currentState: "EXIT", event: "CANDIDATE_VALID" });
  assert.equal(again.nextState, "EXIT");
});

test("unconfirmed exit event cannot force EXIT", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "EXIT_TRIGGERED", exitConditionConfirmed: false });
  assert.equal(r.nextState, "HOLD");
  assert.ok(r.devilFlags.includes("UNCONFIRMED_EXIT_BLOCKED"));
});

test("style or candidate mutation is blocked", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "ACTIVE", sameStyle: false });
  assert.equal(r.nextState, "ACTIVE");
  assert.ok(r.devilFlags.includes("NO_SCALP_TO_SWING_MUTATION"));
});

test("stale data fails closed", () => {
  const r = advanceTradeLifecycle({ ...base, dataFresh: false });
  assert.equal(r.nextState, "DATA_UNAVAILABLE");
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});

test("DATA_UNAVAILABLE returns to WATCH only on a fresh valid candidate event", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "DATA_UNAVAILABLE", event: "CANDIDATE_VALID" });
  assert.equal(r.nextState, "WATCH");
});
