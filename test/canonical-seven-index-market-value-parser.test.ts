import test from "node:test";
import assert from "node:assert/strict";
import { parseOfficialIndexMarketValueHtml, fetchOfficialSevenIndexMarketValues } from "../canonical-seven-index-market-value-parser.ts";
import { CANONICAL_SEVEN_INDEX_SCOPE } from "../canonical-seven-index-intelligence-freeze.ts";

function html(ltp: string, change: string, pct: string) {
  return `<html><body><header><span>${ltp}</span><span>${change}</span><span>${pct}%</span></header><div>As on ,</div><h3>Index Movers</h3><table><tr><td>ABC</td><td>1.00</td><td>100.00</td></tr></table></body></html>`;
}

test("parses official index-level LTP/change/% and derives previous close", () => {
  const parsed = parseOfficialIndexMarketValueHtml({ indexId: "NIFTY_50", html: html("25,205.20", "100.95", "0.40"), fetchedAt: "2026-09-06T03:00:00.000Z" });
  assert.equal(parsed.blocker, null);
  assert.equal(parsed.row?.ltp, 25205.2);
  assert.equal(parsed.row?.change, 100.95);
  assert.equal(parsed.row?.changePct, 0.4);
  assert.equal(parsed.row?.previousClose, 25104.25);
});

test("fails closed on ambiguous header, arithmetic mismatch and page mismatch", () => {
  const ambiguous = html("25,205.20", "100.95", "0.40").replace("</header>", `<span>10,000.00 50.00 0.50%</span></header>`);
  assert.match(parseOfficialIndexMarketValueHtml({ indexId: "NIFTY_50", html: ambiguous }).blocker ?? "", /HEADER_AMBIGUOUS/);
  assert.match(parseOfficialIndexMarketValueHtml({ indexId: "NIFTY_50", html: html("25,205.20", "100.95", "1.40") }).blocker ?? "", /ARITHMETIC_MISMATCH/);
  assert.match(parseOfficialIndexMarketValueHtml({ indexId: "NIFTY_50", html: "<html>no marker</html>" }).blocker ?? "", /PAGE_MISMATCH/);
});

test("all-seven fetch fails closed if server returns same default page for every requested index", async () => {
  const fakeFetch = async () => new Response(html("25,205.20", "100.95", "0.40"), { status: 200 });
  const result = await fetchOfficialSevenIndexMarketValues(fakeFetch as typeof fetch);
  assert.equal(result.rows.length, 0);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((b) => b.startsWith("SEVEN_INDEX_MARKET_VALUE_NOT_DISTINCT:")));
});

test("all-seven fetch accepts distinct validated market values and preserves no-authority boundary", async () => {
  let i = 0;
  const fakeFetch = async () => {
    const n = i++;
    const prev = 10000 + n * 1000;
    const change = 50 + n;
    const ltp = prev + change;
    const pct = (change / prev) * 100;
    return new Response(html(ltp.toFixed(2), change.toFixed(2), pct.toFixed(2)), { status: 200 });
  };
  const result = await fetchOfficialSevenIndexMarketValues(fakeFetch as typeof fetch);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.rows.map((r) => r.indexId), CANONICAL_SEVEN_INDEX_SCOPE);
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
