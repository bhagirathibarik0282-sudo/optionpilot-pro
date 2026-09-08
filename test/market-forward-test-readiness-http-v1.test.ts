import test from "node:test";
import assert from "node:assert/strict";
import { runMarketForwardTestReadinessHttp, runPositioningPairDiagnosticHttp } from "../market-forward-test-readiness-http-v1.js";

test("rejects unsupported symbols before any runtime read", async () => {
  const out = await runMarketForwardTestReadinessHttp({ symbol: "BANKNIFTY", tradeDate: "2026-09-08" });
  assert.equal(out.status, 400);
  assert.equal(out.body.reason, "FORWARD_TEST_SYMBOL_NOT_SUPPORTED");
  assert.equal(out.body.executionEnabled, false);
});

test("rejects invalid market date/range fail closed", async () => {
  const out = await runMarketForwardTestReadinessHttp({ symbol: "NIFTY", tradeDate: "2026-09-31", fromTime: "09:15", toTime: "15:30" });
  assert.equal(out.status, 400);
  assert.equal(out.body.reason, "INVALID_TRADE_DATE");
  assert.equal(out.body.executionEnabled, false);
});

test("positioning diagnostic rejects unsupported symbol fail closed", async () => {
  const out = await runPositioningPairDiagnosticHttp({ symbol: "BANKNIFTY", tradeDate: "2026-09-08" });
  assert.equal(out.status, 400);
  assert.equal(out.body.mode, "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1");
  assert.equal(out.body.reason, "FORWARD_TEST_SYMBOL_NOT_SUPPORTED");
  assert.equal(out.body.executionEnabled, false);
});

test("positioning diagnostic rejects invalid date before runtime read", async () => {
  const out = await runPositioningPairDiagnosticHttp({ symbol: "NIFTY", tradeDate: "2026-09-31", fromTime: "09:15", toTime: "15:30" });
  assert.equal(out.status, 400);
  assert.equal(out.body.mode, "READ_ONLY_POSITIONING_PAIR_DIAGNOSTIC_V1");
  assert.equal(out.body.reason, "INVALID_TRADE_DATE");
  assert.equal(out.body.executionEnabled, false);
});
