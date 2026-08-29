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

test("canonical progression begins WATCH -> ENTRY_READY -> ACTIVE -> HOLD", () => {
  assert.equal(advanceTradeLifecycle({ ...base, event: "ENTRY_CONDITIONS_READY", entryConditionConfirmed: true }).nextState, "ENTRY_READY");
  assert.equal(advanceTradeLifecycle({ ...base, currentState: "ENTRY_READY", event: "ENTRY_ACTIVATED", entryActivatedConfirmed: true }).nextState, "ACTIVE");
  assert.equal(advanceTradeLifecycle({ ...base, currentState: "ACTIVE", event: "THESIS_HOLDING", thesisHoldingConfirmed: true }).nextState, "HOLD");
});

test("HOLD moves to PROTECT only with explicit confirmation", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "PROFIT_PROTECTION_REQUIRED", protectConditionConfirmed: true });
  assert.equal(r.nextState, "PROTECT");
});

test("HOLD cannot skip PROTECT and jump directly to PARTIAL_BOOK", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "HOLD", event: "PARTIAL_BOOK_TRIGGERED", partialBookConditionConfirmed: true });
  assert.equal(r.nextState, "HOLD");
  assert.ok(r.devilFlags.includes("LIFECYCLE_STAGE_SKIP_BLOCKED"));
});

test("PROTECT moves to PARTIAL_BOOK only with explicit confirmation", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "PROTECT", event: "PARTIAL_BOOK_TRIGGERED", partialBookConditionConfirmed: true });
  assert.equal(r.nextState, "PARTIAL_BOOK");
});

test("PROTECT cannot skip PARTIAL_BOOK and jump directly to TRAIL", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "PROTECT", event: "TRAIL_TRIGGERED", trailConditionConfirmed: true });
  assert.equal(r.nextState, "PROTECT");
  assert.ok(r.devilFlags.includes("LIFECYCLE_STAGE_SKIP_BLOCKED"));
});

test("PARTIAL_BOOK moves to TRAIL only with explicit confirmation", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "PARTIAL_BOOK", event: "TRAIL_TRIGGERED", trailConditionConfirmed: true });
  assert.equal(r.nextState, "TRAIL");
});

test("confirmed EXIT can happen after activation and becomes terminal", () => {
  const exited = advanceTradeLifecycle({ ...base, currentState: "ACTIVE", event: "EXIT_TRIGGERED", exitConditionConfirmed: true });
  assert.equal(exited.nextState, "EXIT");
  const again = advanceTradeLifecycle({ ...base, currentState: "EXIT", event: "CANDIDATE_VALID" });
  assert.equal(again.nextState, "EXIT");
});

test("EXIT remains terminal even when later data becomes stale", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "EXIT", dataFresh: false, contractValid: false });
  assert.equal(r.nextState, "EXIT");
  assert.equal(r.changed, false);
  assert.equal(r.dataAvailable, false);
});

test("pre-entry EXIT is blocked even if an exit flag is supplied", () => {
  for (const state of ["WATCH", "ENTRY_READY"] as const) {
    const r = advanceTradeLifecycle({ ...base, currentState: state, event: "EXIT_TRIGGERED", exitConditionConfirmed: true });
    assert.equal(r.nextState, state);
    assert.ok(r.devilFlags.includes("PRE_ENTRY_EXIT_BLOCKED"));
  }
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

test("stale data is an overlay and never mutates lifecycle state", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "HOLD", dataFresh: false });
  assert.equal(r.nextState, "HOLD");
  assert.equal(r.changed, false);
  assert.equal(r.dataAvailable, false);
  assert.ok(r.devilFlags.includes("NO_FRESH_LIFECYCLE_GUIDANCE"));
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});

test("DATA_LOST is an availability overlay and preserves current lifecycle", () => {
  const r = advanceTradeLifecycle({ ...base, currentState: "PROTECT", event: "DATA_LOST" });
  assert.equal(r.nextState, "PROTECT");
  assert.equal(r.dataAvailable, false);
});
