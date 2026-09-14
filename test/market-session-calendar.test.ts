import test from "node:test";
import assert from "node:assert/strict";
import {
  INDIAN_EQUITY_TRADING_HOLIDAYS_2026,
  indianEquityHolidayAt,
  indianEquityMarketPhaseAt,
  indianTradingDateAt,
  isClosedCalendarPhase,
  isIndianEquityMarketOpenAt,
} from "../market-session-calendar.js";

const instant = (iso: string) => new Date(iso);

test("weekday exchange holiday is never classified as a live session", () => {
  const ganeshChaturthiMidday = instant("2026-09-14T07:00:00.000Z"); // 12:30 IST
  assert.equal(indianTradingDateAt(ganeshChaturthiMidday), "2026-09-14");
  assert.equal(indianEquityHolidayAt(ganeshChaturthiMidday)?.name, "Ganesh Chaturthi");
  assert.equal(indianEquityMarketPhaseAt(ganeshChaturthiMidday), "HOLIDAY");
  assert.equal(isIndianEquityMarketOpenAt(ganeshChaturthiMidday), false);
  assert.equal(isClosedCalendarPhase("HOLIDAY"), true);
});

test("regular Tuesday follows opening grace and live-session boundaries", () => {
  assert.equal(indianEquityMarketPhaseAt(instant("2026-09-15T03:49:00.000Z")), "OPENING_GRACE"); // 09:19 IST
  assert.equal(isIndianEquityMarketOpenAt(instant("2026-09-15T03:49:00.000Z")), true); // recorder is active
  assert.equal(indianEquityMarketPhaseAt(instant("2026-09-15T03:51:00.000Z")), "LIVE_SESSION"); // 09:21 IST
  assert.equal(isIndianEquityMarketOpenAt(instant("2026-09-15T04:00:00.000Z")), true);
});

test("weekend remains closed independently of the holiday list", () => {
  const sunday = instant("2026-09-13T07:00:00.000Z");
  assert.equal(indianEquityMarketPhaseAt(sunday), "WEEKEND");
  assert.equal(isIndianEquityMarketOpenAt(sunday), false);
});

test("2026 calendar contains unique reviewed dates and Ganesh Chaturthi", () => {
  const dates = INDIAN_EQUITY_TRADING_HOLIDAYS_2026.map((holiday) => holiday.date);
  assert.equal(new Set(dates).size, dates.length);
  assert.ok(dates.includes("2026-09-14"));
});

test("startup wiring owns calendar, market-open and closed-truth integration", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/wire-market-session-calendar.mjs", import.meta.url), "utf8");
  assert.match(source, /isIndianEquityMarketOpenAt/);
  assert.match(source, /indianEquityMarketPhaseAt/);
  assert.match(source, /INDIAN_EQUITY_TRADING_HOLIDAYS_2026/);
  assert.match(source, /market_closed_/);
});
