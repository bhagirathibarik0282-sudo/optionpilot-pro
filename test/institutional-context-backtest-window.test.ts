import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backfill = readFileSync("scripts/backfill-institutional-context-2026-08-31-to-2026-09-10.ts", "utf8");
const reader = readFileSync("scripts/read-institutional-backtest-window-2026-08-31-to-2026-09-10.ts", "utf8");

const expectedPairs = [
  ["2026-08-31", "2026-09-01"],
  ["2026-09-01", "2026-09-02"],
  ["2026-09-02", "2026-09-03"],
  ["2026-09-03", "2026-09-04"],
  ["2026-09-04", "2026-09-07"],
  ["2026-09-07", "2026-09-08"],
  ["2026-09-08", "2026-09-09"],
  ["2026-09-09", "2026-09-10"],
  ["2026-09-10", "2026-09-11"],
] as const;

test("institutional source window contains the exact Aug-31 to Sep-10 trading calendar", () => {
  for (const [contextDate, eligibleDate] of expectedPairs) {
    assert.match(backfill, new RegExp(`d:\\"${contextDate}\\", signalFrom:\\"${eligibleDate}\\"`));
    assert.ok(eligibleDate > contextDate, `${contextDate} must not be eligible on the same day`);
  }
});

test("backtest reader uses prior-session context and exposes eight Sep-1 to Sep-10 tradable sessions", () => {
  assert.match(reader, /o\.trade_date = c\.signal_eligible_from/);
  assert.match(reader, /c\.trade_date BETWEEN '2026-08-31' AND '2026-09-09'/);
  assert.match(reader, /c\.signal_eligible_from BETWEEN '2026-09-01' AND '2026-09-10'/);
  assert.match(reader, /expected=8/);
  assert.match(reader, /institutional_context_date >= r\.trade_date/);
});

test("same-day institutional context is explicitly guarded against look-ahead", () => {
  assert.match(backfill, /INSTITUTIONAL_BACKFILL_LOOKAHEAD_GUARD_FAILED/);
  assert.match(reader, /INSTITUTIONAL_BACKTEST_LOOKAHEAD_DETECTED/);
  assert.doesNotMatch(reader, /ON o\.trade_date = c\.trade_date/);
});
