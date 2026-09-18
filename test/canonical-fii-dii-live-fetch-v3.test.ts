import test from "node:test";
import assert from "node:assert/strict";
import { fetchOfficialFiiDiiLiveV3 } from "../canonical-fii-dii-live-fetch-v3.ts";

function payload(date: string) {
  return [
    { category: "DII", date, buyValue: "120", sellValue: "100", netValue: "20" },
    { category: "FII/FPI", date, buyValue: "90", sellValue: "100", netValue: "-10" },
  ];
}

test("does not accept a structurally valid cash payload behind the expected market session", async () => {
  const fakeFetch = async () => new Response(JSON.stringify(payload("16-Sep-2026")), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const out = await fetchOfficialFiiDiiLiveV3({
    retryCount: 0,
    expectedMarketSessionDate: "2026-09-18",
  }, fakeFetch as typeof fetch);

  assert.equal(out.ok, false);
  assert.equal(out.attempts, 1);
  assert.equal(out.blocker, "FII_DII_CASH_NOT_PUBLISHED_YET:2026-09-16<2026-09-18");
});

test("accepts the official cash payload for the exact expected market session", async () => {
  const fakeFetch = async () => new Response(JSON.stringify(payload("18-Sep-2026")), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const out = await fetchOfficialFiiDiiLiveV3({
    retryCount: 0,
    expectedMarketSessionDate: "2026-09-18",
  }, fakeFetch as typeof fetch);

  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].date, "2026-09-18");
});

test("rejects an invalid expected market-session date before fetching", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return new Response("[]");
  };

  const out = await fetchOfficialFiiDiiLiveV3({
    retryCount: 0,
    expectedMarketSessionDate: "18-09-2026",
  }, fakeFetch as typeof fetch);

  assert.equal(out.ok, false);
  assert.equal(out.blocker, "FII_DII_FETCH_POLICY_INVALID");
  assert.equal(calls, 0);
});
