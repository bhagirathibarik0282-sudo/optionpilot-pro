import test from "node:test";
import assert from "node:assert/strict";
import { parseOfficialNseAllIndicesPayload, fetchOfficialSevenIndexMarketValues, SEVEN_INDEX_NSE_API_NAMES } from "../canonical-seven-index-market-value-parser.ts";
import { CANONICAL_SEVEN_INDEX_SCOPE } from "../canonical-seven-index-intelligence-freeze.ts";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: CANONICAL_SEVEN_INDEX_SCOPE.map((indexId, i) => {
      const previousClose = 10000 + i * 1000;
      const variation = 50 + i;
      const last = previousClose + variation;
      return {
        index: SEVEN_INDEX_NSE_API_NAMES[indexId],
        last,
        variation,
        percentChange: Number(((variation / previousClose) * 100).toFixed(2)),
        previousClose,
        advances: 10 + i,
        declines: 5 + i,
        unchanged: 1,
        ...overrides,
      };
    }),
  };
}

test("parses exact seven official NSE allIndices rows and market values", () => {
  const result = parseOfficialNseAllIndicesPayload(payload(), "2026-09-06T03:00:00.000Z");
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.rows.map((row) => row.indexId), CANONICAL_SEVEN_INDEX_SCOPE);
  assert.equal(result.rows[0].nseApiName, "NIFTY 50");
  assert.equal(result.rows[0].ltp, 10050);
  assert.equal(result.rows[0].previousClose, 10000);
});

test("fails closed on missing/duplicate identities and arithmetic mismatch", () => {
  const missing = payload();
  (missing.data as Record<string, unknown>[]).pop();
  assert.equal(parseOfficialNseAllIndicesPayload(missing).ready, false);

  const duplicate = payload();
  (duplicate.data as Record<string, unknown>[]).push({ ...(duplicate.data as Record<string, unknown>[])[0] });
  assert.equal(parseOfficialNseAllIndicesPayload(duplicate).ready, false);

  const bad = payload();
  (bad.data as Record<string, unknown>[])[0].variation = 999;
  assert.equal(parseOfficialNseAllIndicesPayload(bad).ready, false);
});

test("fails closed when values collapse to implausibly identical index rows", () => {
  const same = payload();
  for (const row of same.data as Record<string, unknown>[]) {
    row.last = 10050;
    row.previousClose = 10000;
    row.variation = 50;
    row.percentChange = 0.5;
  }
  const result = parseOfficialNseAllIndicesPayload(same);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((b) => b.startsWith("SEVEN_INDEX_API_VALUES_NOT_DISTINCT:")));
});

test("fetch uses exact official payload and preserves no-authority boundary", async () => {
  const fakeFetch = async (url: string | URL | Request) => {
    if (String(url).includes("/api/allIndices")) return Response.json(payload(), { status: 200 });
    return new Response("home", { status: 200, headers: { "set-cookie": "nse=abc; Path=/" } });
  };
  const result = await fetchOfficialSevenIndexMarketValues(fakeFetch as typeof fetch);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.equal(result.rows.length, 7);
  assert.equal(result.readOnly, true);
  assert.equal(result.contextOnly, true);
  assert.equal(result.calculatesWeightedBreadth, false);
  assert.equal(result.grantsDirectionalSupport, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsCandidate, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.failClosed, true);
});
