import test from "node:test";
import assert from "node:assert/strict";
import { archiveKey, decideEodArchive, indiaTradingDateFromIso, isIsoTradingDate, isWeekdayTradingCandidate } from "../eod-archive-core.js";

test("valid archive decision runs when source data exists and date is not completed", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-28T11:10:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, true);
  assert.equal(d.status, "STARTED");
});

test("duplicate prevention blocks an already completed trading date", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-29T04:00:00Z", alreadyCompleted: true, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, false);
  assert.equal(d.status, "ALREADY_COMPLETED");
  assert.equal(d.reason, "IDEMPOTENT_DUPLICATE_GUARD");
});

test("restart retry remains allowed after non-completed prior attempt", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-29T04:00:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, true);
});

test("no source rows fails closed without fabricating archive", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-28T11:10:00Z", alreadyCompleted: false, sourceRecordCount: 0 });
  assert.equal(d.shouldRun, false);
  assert.equal(d.status, "SKIPPED_NO_DATA");
});

test("weekday candidate and weekend rejection", () => {
  assert.equal(isWeekdayTradingCandidate("2026-08-28"), true);
  assert.equal(isWeekdayTradingCandidate("2026-08-29"), false);
  assert.equal(isWeekdayTradingCandidate("2026-08-30"), false);
});

test("India date conversion is timezone-correct across UTC boundary", () => {
  assert.equal(indiaTradingDateFromIso("2026-08-28T20:00:00Z"), "2026-08-29");
});

test("archive key is deterministic and invalid dates are rejected", () => {
  assert.equal(archiveKey("2026-08-28"), "EOD:2026-08-28");
  assert.equal(isIsoTradingDate("2026-02-30"), false);
  assert.throws(() => archiveKey("bad-date"), /INVALID_TRADING_DATE/);
});
