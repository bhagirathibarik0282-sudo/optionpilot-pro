import test from "node:test";
import assert from "node:assert/strict";
import { buildTelegramStyleRoute } from "../telegram-style-route.js";

test("SCALP routes to Special Option Selection with scalp heading", () => {
  const out = buildTelegramStyleRoute({ style: "SCALP", symbol: "NIFTY", side: "CE" });
  assert.equal(out.destination, "SPECIAL_OPTION_SELECTION");
  assert.equal(out.heading, "🔥 SCALP TRADE • NIFTY • BUY CE");
  assert.equal(out.affectsTelegram, false);
});

test("SWING routes to same Special Option Selection destination", () => {
  const out = buildTelegramStyleRoute({ style: "SWING", symbol: "BANKNIFTY", side: "PE" });
  assert.equal(out.destination, "SPECIAL_OPTION_SELECTION");
  assert.equal(out.heading, "🔥 SWING TRADE • BANKNIFTY • BUY PE");
});

test("normal TRADE keeps same group with plain trade heading", () => {
  const out = buildTelegramStyleRoute({ style: "TRADE", symbol: "SENSEX", side: "CE" });
  assert.equal(out.destination, "SPECIAL_OPTION_SELECTION");
  assert.equal(out.heading, "🔥 TRADE • SENSEX • BUY CE");
});

test("empty symbol fails closed", () => {
  assert.throws(() => buildTelegramStyleRoute({ style: "SCALP", symbol: "  ", side: "CE" }), /symbol is required/);
});
