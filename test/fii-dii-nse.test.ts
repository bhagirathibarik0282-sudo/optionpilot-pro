import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNseFiiDiiFreshness,
  fetchNseFiiDii,
  normalizeNseDate,
  parseNseFiiDiiResponse,
} from "../fii-dii-nse.js";

test("normalizes supported NSE date formats including official DD-MMM-YYYY", () => {
  assert.equal(normalizeNseDate("2026-08-28"), "2026-08-28");
  assert.equal(normalizeNseDate("28-08-2026"), "2026-08-28");
  assert.equal(normalizeNseDate("28/08/2026"), "2026-08-28");
  assert.equal(normalizeNseDate("28-Aug-2026"), "2026-08-28");
});

test("parses standard FII/DII cash payload and recomputes net", () => {
  const result = parseNseFiiDiiResponse([
    { category: "FII/FPI", date: "28-Aug-2026", buyValue: "12,000.50", sellValue: "13,500.25" },
    { category: "DII", date: "28-Aug-2026", buyValue: "14,000", sellValue: "11,000" },
  ], "2026-08-29T00:00:00.000Z");

  assert.equal(result.date, "2026-08-28");
  assert.equal(result.fii.net, -1499.75);
  assert.equal(result.dii.net, 3000);
  assert.equal(result.source, "NSE_FII_DII");
});

test("rejects mismatched FII and DII dates", () => {
  assert.throws(() => parseNseFiiDiiResponse([
    { category: "FII", date: "28-Aug-2026", buyValue: 10, sellValue: 5 },
    { category: "DII", date: "27-Aug-2026", buyValue: 5, sellValue: 10 },
  ]), /NSE_FII_DII_DATE_MISMATCH/);
});

test("rejects stale explicit source date against expected trading session", () => {
  assert.throws(() => assertNseFiiDiiFreshness("2026-08-27", "2026-08-28"), /STALE_NSE_FII_DII_DATE/);
});

test("accepts exact expected trading-session date", () => {
  assert.doesNotThrow(() => assertNseFiiDiiFreshness("28-Aug-2026", "2026-08-28"));
});

test("fetch rejects stale payload before caller can persist it", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("<html></html>", { status: 200 });
    return new Response(JSON.stringify([
      { category: "FII/FPI", date: "27-Aug-2026", buyValue: 100, sellValue: 90 },
      { category: "DII", date: "27-Aug-2026", buyValue: 80, sellValue: 70 },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => fetchNseFiiDii(fakeFetch as typeof fetch, "2026-08-28"),
    /STALE_NSE_FII_DII_DATE/,
  );
  assert.equal(calls, 2);
});
