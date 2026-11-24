import { productionVerificationPending } from './helpers/production-runtime.js';
import test from "node:test";
import assert from "node:assert/strict";

const BASE = "https://optionpilot-pro-v2-production.up.railway.app/api/research/business-dashboard";

for (const symbol of ["NIFTY","SENSEX"] as const) {
  test(`production Business Dashboard V1 JSON responds for ${symbol}`, async (t) => {
    const response = await fetch(`${BASE}?symbol=${symbol}`, { headers:{ accept:"application/json" } });
  if (await productionVerificationPending(response, t)) return;
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

test("production Business Dashboard V1 HTML view exposes a supported read-only dashboard during rollout", async (t) => {
  const response = await fetch(`${BASE}/view?symbol=NIFTY`, { headers:{ accept:"text/html" } });
  if (await productionVerificationPending(response, t)) return;
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const html = await response.text();
  assert.match(html, /viewport/);
  // The previous off-hours facade is a known rollout state, not acceptance of the unified terminal.
  if (response.headers.get('x-optionpilot-mode') === 'RECORDED_READ_ONLY' && html.includes('<title>OptionPilot · Recorded Replay</title>')) {
    assert.match(html,/Saved sessions & Replay/);
    t.skip('Previous recorded-only facade is still deployed; unified terminal production acceptance pending');
    return;
  }
  if(response.headers.get('x-optionpilot-mode') === 'RECORDED_READ_ONLY') {
    assert.match(html,/id="op-recorded-mode"/);
    assert.match(html,/id="mb-live-watch" open/);
    assert.match(html,/id="mb-shared-memory"/);
  }
  // Production may still serve the previous release while this PR is checked.
  if (html.includes('Market observations')) {
    assert.match(html, /DATA ONLY/);
    assert.match(html, /Premium PDH \/ PDL breaks/);
    assert.match(html, /full_chain_oi_pcr/);
    assert.doesNotMatch(html, /id="business-decision-card"/);
  } else {
    assert.match(html, /BUSINESS DASHBOARD V1/);
    assert.match(html, /READ ONLY/);
  }
});
