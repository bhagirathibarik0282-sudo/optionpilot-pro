import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalFiiDiiOfficialContext, fetchOfficialFiiDiiCsv, parseOfficialFiiDiiCsv } from "../canonical-fii-dii-official-context.js";

const sourceUrl = "https://www.nseindia.com/reports/fii-dii";

function historyCsv(days = 20): string {
  const lines = ["Category,Date,Buy Value(₹ Crores),Sell Value (₹ Crores),Net Value (₹ Crores)"];
  for (let i = 0; i < days; i++) {
    const day = String(i + 1).padStart(2, "0");
    const fiiBuy = 1000 + i * 10; const fiiSell = 900 + i * 5; const fiiNet = fiiBuy - fiiSell;
    const diiBuy = 800 + i * 4; const diiSell = 850 + i * 2; const diiNet = diiBuy - diiSell;
    lines.push(`FII/FPI,${day}-Aug-2026,${fiiBuy},${fiiSell},${fiiNet}`);
    lines.push(`DII,${day}-Aug-2026,${diiBuy},${diiSell},${diiNet}`);
  }
  return lines.join("\n");
}

test("parses exact FII/FPI and DII sessions and builds 1D/3D/5D/20D numeric context", () => {
  const out = buildCanonicalFiiDiiOfficialContext({ sourceUrl, csv: historyCsv(), asOfDate: "2026-08-21", maxStaleCalendarDays: 3 });
  assert.equal(out.ready, true);
  assert.equal(out.latestSessionDate, "2026-08-20");
  assert.equal(out.rows.length, 40);
  assert.deepEqual(out.windows.map((x) => x.window), ["1D", "3D", "5D", "20D"]);
  assert.equal(out.windows.find((x) => x.window === "1D")?.sessions, 1);
  assert.equal(out.windows.find((x) => x.window === "20D")?.sessions, 20);
  assert.equal(out.semantics, "INSTITUTIONAL_FLOW_CONTEXT_ONLY_NO_DIRECTION_TRUTH");
  assert.equal(out.estimatesMissingValues, false);
  assert.equal(out.grantsDirectionalSupport, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsCandidate, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
});

test("rejects malformed, duplicate, incomplete and inconsistent net rows instead of estimating", () => {
  const malformed = parseOfficialFiiDiiCsv("Category,Date,Buy Value,Sell Value,Net Value\nFII/FPI,20-Aug-2026,1000,900,100\nDII,20-Aug-2026,800,,50");
  assert.ok(malformed.blockers.includes("FII_DII_ROW_MALFORMED"));
  assert.ok(malformed.blockers.includes("FII_DII_INCOMPLETE_SESSION:2026-08-20"));

  const duplicate = parseOfficialFiiDiiCsv("Category,Date,Buy Value,Sell Value,Net Value\nFII/FPI,20-Aug-2026,1000,900,100\nFII/FPI,20-Aug-2026,1000,900,100\nDII,20-Aug-2026,800,850,-50");
  assert.ok(duplicate.blockers.includes("FII_DII_DUPLICATE:2026-08-20:FII_FPI"));

  const mismatch = parseOfficialFiiDiiCsv("Category,Date,Buy Value,Sell Value,Net Value\nFII/FPI,20-Aug-2026,1000,900,99\nDII,20-Aug-2026,800,850,-50");
  assert.ok(mismatch.blockers.includes("FII_DII_NET_MISMATCH:2026-08-20:FII_FPI"));
});

test("fails closed on non-official source, stale/future data and insufficient 20D history", () => {
  assert.equal(buildCanonicalFiiDiiOfficialContext({ sourceUrl: "https://example.com/fii.csv", csv: historyCsv(), asOfDate: "2026-08-21", maxStaleCalendarDays: 3 }).ready, false);
  assert.equal(buildCanonicalFiiDiiOfficialContext({ sourceUrl, csv: historyCsv(), asOfDate: "2026-08-31", maxStaleCalendarDays: 3 }).ready, false);
  assert.equal(buildCanonicalFiiDiiOfficialContext({ sourceUrl, csv: historyCsv(), asOfDate: "2026-08-19", maxStaleCalendarDays: 3 }).ready, false);
  assert.equal(buildCanonicalFiiDiiOfficialContext({ sourceUrl, csv: historyCsv(19), asOfDate: "2026-08-21", maxStaleCalendarDays: 3 }).ready, false);
});

test("official fetch retries without fabricating missing data", async () => {
  let calls = 0;
  const mockFetch = (async () => {
    calls++;
    if (calls === 1) throw new Error("temporary");
    return new Response(historyCsv(), { status: 200, headers: { "content-type": "text/csv" } });
  }) as typeof fetch;
  const result = await fetchOfficialFiiDiiCsv({ sourceUrl, asOfDate: "2026-08-21", maxStaleCalendarDays: 3, retryCount: 1 }, mockFetch);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.ok(result.csv?.includes("FII/FPI"));

  const failFetch = (async () => new Response("", { status: 503 })) as typeof fetch;
  const failed = await fetchOfficialFiiDiiCsv({ sourceUrl, asOfDate: "2026-08-21", maxStaleCalendarDays: 3, retryCount: 1 }, failFetch);
  assert.equal(failed.ok, false);
  assert.equal(failed.csv, null);
  assert.equal(failed.blocker, "FII_DII_OFFICIAL_FETCH_FAILED");
});
