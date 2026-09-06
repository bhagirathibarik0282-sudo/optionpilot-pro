import test from "node:test";
import assert from "node:assert/strict";
import { fetchOfficialSevenIndexMarketValues } from "../canonical-seven-index-market-value-parser.ts";

test("official NSE Indices live pages yield seven distinct validated market-value rows", { timeout: 45_000 }, async () => {
  const result = await fetchOfficialSevenIndexMarketValues(fetch);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.equal(result.rows.length, 7);
  assert.ok(result.rows.every((row) => row.ltp > 0 && row.previousClose > 0 && Number.isFinite(row.changePct)));
  assert.ok(new Set(result.rows.map((row) => row.ltp.toFixed(2))).size >= 5);
});
