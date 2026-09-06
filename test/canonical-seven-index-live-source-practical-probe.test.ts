import test from "node:test";
import assert from "node:assert/strict";
import { probeOfficialSevenIndexPages } from "../canonical-seven-index-live-source-probe.ts";

test("official NSE Indices pages are practically reachable for all seven frozen indices", { timeout: 30_000 }, async () => {
  const result = await probeOfficialSevenIndexPages(fetch);
  assert.equal(result.rows.length, 7);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.ok(result.rows.every((row) => row.ok && row.status === 200));
});
