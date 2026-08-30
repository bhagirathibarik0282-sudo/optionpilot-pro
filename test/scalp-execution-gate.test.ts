import test from "node:test";
import assert from "node:assert/strict";
import { evaluateScalpExecutionGate } from "../scalp-execution-gate.ts";

const policy = {
  openingNoEntryUntil: "09:20",
  lateStrictFrom: "15:00",
  noFreshEntryFrom: "15:10",
  expiryDayNoFreshEntryFrom: "14:45",
  minCooldownSeconds: 180,
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "NIFTY" as const,
    marketTimeIst: "10:00",
    isExpiryDay: false,
    nearestWeeklyDte: 1,
    nearestDteUsable: true,
    liquidityOk: true,
    spreadOk: true,
    dataFresh: true,
    setupFresh: true,
    setupId: "NIFTY-SETUP-2",
    previousSetupId: "NIFTY-SETUP-1",
    secondsSincePreviousExit: 300,
    activeIndexPosition: null,
    niftyScore: 80,
    sensexScore: 70,
    minScoreGap: 5,
    allRiskGatesPassed: true,
    policy,
    ...overrides,
  };
}

test("allows NIFTY when it is the stronger fresh setup", () => {
  const r = evaluateScalpExecutionGate(base());
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.winner, "NIFTY");
});

test("blocks SENSEX when NIFTY has stronger setup", () => {
  const r = evaluateScalpExecutionGate(base({ symbol: "SENSEX" }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("OTHER_INDEX_HAS_STRONGER_SETUP"));
});

test("blocks any new trade when one correlated index is active", () => {
  const r = evaluateScalpExecutionGate(base({ activeIndexPosition: "SENSEX" }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("SENSEX_ACTIVE_NIFTY_LOCKED"));
});

test("blocks opening-noise window", () => {
  const r = evaluateScalpExecutionGate(base({ marketTimeIst: "09:17" }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("OPENING_STABILIZATION_NO_ENTRY"));
});

test("blocks fresh entries from 15:10 onward", () => {
  const r = evaluateScalpExecutionGate(base({ marketTimeIst: "15:10" }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("NO_FRESH_SCALP_ENTRY_TIME_REACHED"));
});

test("blocks expiry-day fresh entries from 14:45 onward", () => {
  const r = evaluateScalpExecutionGate(base({ marketTimeIst: "14:45", isExpiryDay: true }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("EXPIRY_DAY_FRESH_ENTRY_CUTOFF_REACHED"));
});

test("blocks duplicate setup re-fire", () => {
  const r = evaluateScalpExecutionGate(base({ setupId: "SAME", previousSetupId: "SAME" }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("DUPLICATE_SETUP_ID"));
});

test("blocks before cooldown completes", () => {
  const r = evaluateScalpExecutionGate(base({ secondsSincePreviousExit: 179 }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("COOLDOWN_NOT_COMPLETED"));
});

test("blocks when NIFTY and SENSEX scores are too close", () => {
  const r = evaluateScalpExecutionGate(base({ niftyScore: 80, sensexScore: 77, minScoreGap: 5 }));
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INDEX_SCORES_TOO_CLOSE_NO_TRADE"));
});

test("blocks stale data or unusable nearest DTE", () => {
  const stale = evaluateScalpExecutionGate(base({ dataFresh: false }));
  const dte = evaluateScalpExecutionGate(base({ nearestDteUsable: false }));
  assert.equal(stale.decision, "BLOCK");
  assert.equal(dte.decision, "BLOCK");
});

test("late window can pass but is explicitly tagged strict", () => {
  const r = evaluateScalpExecutionGate(base({ marketTimeIst: "15:05" }));
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.strictWindow, true);
  assert.deepEqual(r.reasonCodes, ["LATE_STRICT_WINDOW_PASSED"]);
});
