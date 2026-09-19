import test from "node:test";
import assert from "node:assert/strict";
import { nextFiiDiiCashCatchupAt } from "../fii-dii-cash-catchup-scheduler.js";

test("fallback uses the existing 19:00 IST FII/DII cron time", () => {
  assert.equal(
    nextFiiDiiCashCatchupAt(new Date("2026-09-18T10:00:00.000Z")).toISOString(),
    "2026-09-18T13:30:00.000Z",
  );
});

test("after the existing cron time next fallback is next calendar day", () => {
  assert.equal(
    nextFiiDiiCashCatchupAt(new Date("2026-09-18T13:31:00.000Z")).toISOString(),
    "2026-09-19T13:30:00.000Z",
  );
});
