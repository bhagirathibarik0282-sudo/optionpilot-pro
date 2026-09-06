import test from "node:test";
import assert from "node:assert/strict";

const URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/broad-market-size/recovery-audit";

test("production recovery audit proves the existing seven-index historical archive", async () => {
  const response = await fetch(URL, { headers: { accept: "application/json" } });
  const text = await response.text();
  console.log(`[RECOVERY_PRODUCTION_PROOF] status=${response.status} body=${text}`);
  assert.equal(response.ok, true, `HTTP_${response.status}:${text}`);

  const payload = JSON.parse(text) as {
    ok?: boolean;
    ready?: boolean;
    exactSevenCoverage?: boolean;
    allHaveApproxTenCalendarYears?: boolean;
    runtimeCurrentlyTruncatesHistory?: boolean;
    rows?: Array<{ indexCode: string; totalDailyRows: number; earliestTradeDate: string | null; latestTradeDate: string | null; rowsOutsideRuntimeWindow: number }>;
    blockers?: string[];
  };

  assert.equal(payload.ok, true, `AUDIT_NOT_OK:${JSON.stringify(payload.blockers ?? [])}`);
  assert.equal(payload.ready, true, `AUDIT_NOT_READY:${JSON.stringify(payload.blockers ?? [])}`);
  assert.equal(payload.exactSevenCoverage, true);
  assert.equal(payload.allHaveApproxTenCalendarYears, true, "TEN_YEAR_ARCHIVE_NOT_PROVEN");
  assert.equal(payload.runtimeCurrentlyTruncatesHistory, true, "ACTIVE_320_ROW_TRUNCATION_NOT_PROVEN");
  assert.equal(payload.rows?.length, 7);
});
