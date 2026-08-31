import test from "node:test";
import assert from "node:assert/strict";
import { parseH1ReplayRequest } from "../h1-replay-http.js";

test("accepts bounded NIFTY full-session replay request", () => {
  const parsed = parseH1ReplayRequest({
    symbol: "nifty",
    tradeDate: "2026-08-31",
    fromTime: "09:15",
    toTime: "15:30",
    scope: "core",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      symbol: "NIFTY",
      tradeDate: "2026-08-31",
      fromTime: "09:15",
      toTime: "15:30",
      scope: "CORE",
    });
  }
});

test("rejects symbols outside the fixed index whitelist", () => {
  const parsed = parseH1ReplayRequest({ symbol: "MIDCPNIFTY", tradeDate: "2026-08-31" });
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_SYMBOL" });
});

test("rejects invalid calendar dates", () => {
  const parsed = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-02-31" });
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_TRADE_DATE" });
});

test("rejects ranges outside the regular market session", () => {
  const beforeOpen = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "09:14", toTime: "15:30" });
  assert.deepEqual(beforeOpen, { ok: false, reason: "OUTSIDE_MARKET_SESSION" });

  const afterClose = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "09:15", toTime: "15:31" });
  assert.deepEqual(afterClose, { ok: false, reason: "OUTSIDE_MARKET_SESSION" });
});

test("rejects reverse time ranges and unknown scopes", () => {
  const reversed = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "12:00", toTime: "11:59" });
  assert.deepEqual(reversed, { ok: false, reason: "INVALID_TIME_RANGE" });

  const badScope = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", scope: "raw" });
  assert.deepEqual(badScope, { ok: false, reason: "INVALID_SCOPE" });
});
