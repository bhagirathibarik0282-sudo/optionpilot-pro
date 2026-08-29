import test from "node:test";
import assert from "node:assert/strict";
import { archiveKey, decideEodArchive, indiaTradingDateFromIso, isIsoTradingDate, isPastArchiveCutoff, isWeekdayTradingCandidate } from "../eod-archive-core.js";

test("valid same-day archive runs after EOD cutoff when source data exists", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-28T10:20:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, true);
  assert.equal(d.status, "STARTED");
});

test("same-day archive is blocked before 15:45 IST cutoff", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-28T09:45:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, false);
  assert.equal(d.status, "TOO_EARLY");
  assert.equal(d.reason, "BEFORE_EOD_CUTOFF");
});

test("future trading date is blocked", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-29", nowIso: "2026-08-28T12:00:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, false);
  assert.equal(d.reason, "FUTURE_TRADING_DATE");
});

test("duplicate prevention blocks an already completed trading date", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-29T04:00:00Z", alreadyCompleted: true, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, false);
  assert.equal(d.status, "ALREADY_COMPLETED");
  assert.equal(d.reason, "IDEMPOTENT_DUPLICATE_GUARD");
});

test("restart retry remains allowed for a historical non-completed date", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-29T04:00:00Z", alreadyCompleted: false, sourceRecordCount: 42 });
  assert.equal(d.shouldRun, true);
});

test("no source rows fails closed without fabricating archive", () => {
  const d = decideEodArchive({ tradingDate: "2026-08-28", nowIso: "2026-08-28T10:20:00Z", alreadyCompleted: false, sourceRecordCount: 0 });
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

test("cutoff helper is timezone-correct", () => {
  assert.equal(isPastArchiveCutoff("2026-08-28T10:14:00Z"), false); // 15:44 IST
  assert.equal(isPastArchiveCutoff("2026-08-28T10:15:00Z"), true);  // 15:45 IST
});

test("archive key is deterministic and invalid dates are rejected", () => {
  assert.equal(archiveKey("2026-08-28"), "EOD:2026-08-28");
  assert.equal(isIsoTradingDate("2026-02-30"), false);
  assert.throws(() => archiveKey("bad-date"), /INVALID_TRADING_DATE/);
});
