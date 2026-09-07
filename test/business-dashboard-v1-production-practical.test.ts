import test from "node:test";
import assert from "node:assert/strict";

const BASE = "https://optionpilot-pro-v2-production.up.railway.app/api/research/business-dashboard";

for (const symbol of ["NIFTY","SENSEX"] as const) {
  test(`production Business Dashboard V1 JSON responds for ${symbol}`, async () => {
    const response = await fetch(`${BASE}?symbol=${symbol}`, { headers:{ accept:"application/json" } });
    assert.equal(response.ok, true, `HTTP_${response.status}`);
    const body:any = await response.json();
    console.log(JSON.stringify(body));
    assert.equal(body.mode, "READ_ONLY_BUSINESS_DASHBOARD_V1");
    assert.equal(body.productionImpact, "NONE");
    assert.equal(body.version, "BUSINESS_DASHBOARD_V1");
    assert.equal(body.symbol, symbol);
    assert.equal(body.readOnly, true);
    assert.equal(body.affectsCandidateAuthority, false);
    assert.equal(body.affectsTelegram, false);
    assert.equal(body.affectsExecution, false);
    assert.equal(body.createsOrders, false);
    assert.equal(body.sameCanonicalCandidateForDashboardAndTelegram, true);
    assert.equal(body.horizons.length, 3);
  });
}

test("production Business Dashboard V1 HTML view is mobile-readable and business-focused", async () => {
  const response = await fetch(`${BASE}/view?symbol=NIFTY`, { headers:{ accept:"text/html" } });
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const html = await response.text();
  assert.match(html, /BUSINESS DASHBOARD V1/);
  assert.match(html, /BUYER/);
  assert.match(html, /SELLER/);
  assert.match(html, /INTRADAY/);
  assert.match(html, /MULTIDAY/);
  assert.match(html, /EXPIRY/);
  assert.match(html, /viewport/);
  assert.match(html, /READ ONLY/);
});
