import test from "node:test";
import assert from "node:assert/strict";
import { renderH1TheoryDashboardHtml } from "../h1-theory-dashboard-view.js";

test("renders date, index and intraday filters with fail-closed safety disclosure", () => {
  const html = renderH1TheoryDashboardHtml();
  assert.match(html, /Recorded-Day Evidence Filter/);
  assert.match(html, /NIFTY.*SENSEX.*BANKNIFTY/s);
  assert.match(html, /type="time" value="09:15"/);
  assert.match(html, /type="time" value="15:30"/);
  assert.match(html, /UNKNOWN is never neutral/);
  assert.match(html, /affectsVerdict|live verdict/);
  assert.match(html, /Closing Auction Scanner/);
  assert.match(html, /PROXY ONLY/);
  assert.match(html, /not a prediction or trade signal/);
});
