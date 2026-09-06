import assert from "node:assert/strict";
import test from "node:test";

const DASHBOARD_URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/broad-market-size/dashboard";
const VIEW_URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/broad-market-size/view";

test("production Intelligence dashboard exposes canonical Market DNA only", async () => {
  const response = await fetch(DASHBOARD_URL, { headers: { accept: "application/json" } });
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const body = await response.json() as any;
  console.log(JSON.stringify(body));

  assert.equal(body.ready, true);
  assert.equal(body.source, "MARKET_DNA_CONTEXT");
  assert.equal(body.contextOnly, true);
  assert.equal(body.readOnly, true);
  assert.equal(body.duplicateVoteForbidden, true);
  assert.equal(body.grantsDirectionalSupport, false);
  assert.equal(body.affectsVerdictDirectly, false);
  assert.equal(body.affectsCandidateDirectly, false);
  assert.equal(body.affectsTelegramDirectly, false);
  assert.equal(body.affectsExecution, false);
  assert.equal(body.weightedConstituentBreadthReady, false);
  assert.equal(body.weightedConstituentBreadthPct, null);
  assert.ok(body.historicalObservationFloor > 320);
  assert.equal(body.tenYearWindowReady, true);
  assert.ok(body.regime);
  assert.ok(body.rotationState);
  assert.ok(body.divergenceState);
});

test("production Intelligence HTML view is canonical display-only", async () => {
  const response = await fetch(VIEW_URL, { headers: { accept: "text/html" } });
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const html = await response.text();
  assert.match(html, /OptionPilot Intelligence/i);
  assert.match(html, /MARKET DNA/i);
  assert.match(html, /TRUE WEIGHTED BREADTH/i);
  assert.match(html, /NOT READY/i);
  assert.match(html, /DISPLAY ONLY/i);
});
