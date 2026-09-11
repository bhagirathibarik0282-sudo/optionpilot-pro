import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EOD_RETENTION_DAYS,
  indiaDateFromIso,
  resolveRetentionDays,
  resolveRetentionMode,
  retentionCutoffDate,
} from "../eod-retention-core.js";

test("defaults to 60 days", () => {
  assert.equal(resolveRetentionDays(undefined), DEFAULT_EOD_RETENTION_DAYS);
});

test("rejects unsafe retention windows below 30 days", () => {
  assert.throws(() => resolveRetentionDays("29"), /EOD_RETENTION_DAYS_INVALID/);
});

test("computes inclusive 60-day cutoff", () => {
  assert.equal(retentionCutoffDate("2026-09-11", 60), "2026-07-14");
});

test("uses India trading date", () => {
  assert.equal(indiaDateFromIso("2026-09-10T19:00:00.000Z"), "2026-09-11");
});

test("retention defaults to dry run and requires explicit apply flag", () => {
  assert.equal(resolveRetentionMode({} as NodeJS.ProcessEnv), "DRY_RUN");
  assert.equal(resolveRetentionMode({ EOD_RETENTION_APPLY: "true" } as NodeJS.ProcessEnv), "APPLY");
});
