import test from "node:test";
import assert from "node:assert/strict";
import { fetchOfficialFiiDiiApi } from "../canonical-fii-dii-practical-ingest-v2.ts";

test("live NSE FII DII endpoint is practically reachable and returns one complete recent session", async () => {
  const result = await fetchOfficialFiiDiiApi({ retryCount: 2 });
  assert.equal(result.ok, true, result.blocker ?? "NSE live fetch failed");
  assert.equal(result.rows.length, 2);
  const dates = [...new Set(result.rows.map((row) => row.date))];
  assert.equal(dates.length, 1);
  assert.equal(result.rows.some((row) => row.category === "FII_FPI"), true);
  assert.equal(result.rows.some((row) => row.category === "DII"), true);
  const latest = Date.parse(`${dates[0]}T00:00:00Z`);
  const now = Date.now();
  assert.ok(latest <= now + 86_400_000, "NSE returned a future-dated session");
  assert.ok(now - latest <= 7 * 86_400_000, `NSE session is unexpectedly stale: ${dates[0]}`);
});
