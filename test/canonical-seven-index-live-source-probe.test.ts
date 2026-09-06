import test from "node:test";
import assert from "node:assert/strict";
import {
  officialSevenIndexPageUrl,
  probeOfficialSevenIndexPages,
  SEVEN_INDEX_OFFICIAL_PAGE_NAMES,
} from "../canonical-seven-index-live-source-probe.ts";
import { CANONICAL_SEVEN_INDEX_SCOPE } from "../canonical-seven-index-intelligence-freeze.ts";

test("maps the exact frozen seven-index scope to official NSE Indices pages", () => {
  assert.equal(Object.keys(SEVEN_INDEX_OFFICIAL_PAGE_NAMES).length, 7);
  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) {
    const url = new URL(officialSevenIndexPageUrl(indexId));
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.niftyindices.com");
    assert.equal(url.pathname, "/market-data/index-moversData");
    assert.equal(url.searchParams.get("Iname"), SEVEN_INDEX_OFFICIAL_PAGE_NAMES[indexId]);
  }
});

test("passes only when every official page is reachable and identity-bearing", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const name = url.searchParams.get("Iname") || "";
    return new Response(`<html><body><h3>Index Movers</h3><div>${name}</div></body></html>`, { status: 200 });
  };
  const result = await probeOfficialSevenIndexPages(fetchImpl as typeof fetch);
  assert.equal(result.ready, true);
  assert.equal(result.rows.length, 7);
  assert.equal(result.blockers.length, 0);
});

test("fails closed on one missing identity and grants no downstream authority", async () => {
  let count = 0;
  const fetchImpl = async (input: string | URL | Request) => {
    count += 1;
    const url = new URL(String(input));
    const name = url.searchParams.get("Iname") || "";
    const body = count === 3 ? "<html><body>Index Movers</body></html>" : `<html><body>Index Movers ${name}</body></html>`;
    return new Response(body, { status: 200 });
  };
  const result = await probeOfficialSevenIndexPages(fetchImpl as typeof fetch);
  assert.equal(result.ready, false);
  assert.equal(result.sourceIdentityOnly, true);
  assert.equal(result.parsesMarketValues, false);
  assert.equal(result.grantsDirectionalSupport, false);
  assert.equal(result.affectsCandidate, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.failClosed, true);
});

test("fails closed on HTTP or network failure", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    if (count === 2) return new Response("blocked", { status: 403 });
    if (count === 5) throw new Error("network");
    return new Response("Index Movers Nifty 50 Nifty Next 50 Nifty 100 Nifty 200 Nifty 500 Nifty Midcap 150 Nifty Smallcap 250", { status: 200 });
  };
  const result = await probeOfficialSevenIndexPages(fetchImpl as typeof fetch);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => value.includes("HTTP_403")));
  assert.ok(result.blockers.some((value) => value.includes("FETCH_FAILED")));
});
