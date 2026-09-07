import test from "node:test";
import assert from "node:assert/strict";
import { parseLegacyRecorderRecoveryRequest } from "../h1-legacy-recorder-recovery-http.js";

test("legacy recorder recovery accepts known symbol/date", () => {
  assert.deepEqual(
    parseLegacyRecorderRecoveryRequest({ symbol: "nifty", tradeDate: "2026-09-04" }),
    { ok: true, symbol: "NIFTY", tradeDate: "2026-09-04" },
  );
});

test("legacy recorder recovery rejects invalid symbol/date", () => {
  assert.deepEqual(
    parseLegacyRecorderRecoveryRequest({ symbol: "MIDCPNIFTY", tradeDate: "2026-09-04" }),
    { ok: false, reason: "INVALID_SYMBOL" },
  );
  assert.deepEqual(
    parseLegacyRecorderRecoveryRequest({ symbol: "NIFTY", tradeDate: "2026-02-31" }),
    { ok: false, reason: "INVALID_TRADE_DATE" },
  );
});
