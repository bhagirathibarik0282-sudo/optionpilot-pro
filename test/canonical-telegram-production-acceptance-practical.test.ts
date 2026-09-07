import assert from "node:assert/strict";
import test from "node:test";

const URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/meaningful-live-acceptance";

test("production Telegram acceptance monitor is safe and exposes truthful transport evidence", async () => {
  const response = await fetch(URL, { headers: { accept: "application/json" } });
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const body = await response.json() as any;
  console.log(JSON.stringify(body));

  assert.equal(body.ok, true);
  assert.equal(body.mode, "READ_ONLY_MEANINGFUL_LIVE_ACCEPTANCE_V1");
  assert.equal(body.safety?.readOnlyEndpoint, true);
  assert.equal(body.safety?.changesTelegramPayload, false);
  assert.equal(body.safety?.changesVerdict, false);
  assert.equal(body.safety?.changesExecution, false);
  assert.equal(body.safety?.createsOrders, false);

  const expected = ["NIFTY", "BANKNIFTY", "SENSEX"];
  for (const symbol of expected) {
    const state = body.symbols?.[symbol];
    assert.ok(state, `MISSING_${symbol}`);
    assert.equal(Number(state.runtime?.sendFailures ?? 0), 0, `SEND_FAILURE_${symbol}`);
    assert.ok(typeof state.acceptance === "string" && state.acceptance.length > 0);
  }

  const sent = expected.reduce((n, symbol) => n + Number(body.symbols[symbol].runtime?.meaningfulSent ?? 0), 0);
  console.log(`PRODUCTION_MEANINGFUL_SEND_COUNT_SINCE_PROCESS_START=${sent}`);
});
