import test from "node:test";
import assert from "node:assert/strict";
import { routeStrictTradeHorizon } from "../strict-trade-horizon-router.js";

test("routes every strict DTE boundary without gaps or overlap", () => {
  assert.equal(routeStrictTradeHorizon(0).horizon, "EXPIRY_SCALP_0_1");
  assert.equal(routeStrictTradeHorizon(1).horizon, "EXPIRY_SCALP_0_1");
  assert.equal(routeStrictTradeHorizon(2).horizon, "NORMAL_SCALP_2_6");
  assert.equal(routeStrictTradeHorizon(6).horizon, "NORMAL_SCALP_2_6");
  assert.equal(routeStrictTradeHorizon(7).horizon, "SWING_7_13");
  assert.equal(routeStrictTradeHorizon(13).horizon, "SWING_7_13");
  assert.equal(routeStrictTradeHorizon(14).horizon, "UNSUPPORTED");
});

test("invalid DTE fails closed", () => {
  assert.equal(routeStrictTradeHorizon(-1).reason, "INVALID_DTE");
  assert.equal(routeStrictTradeHorizon(1.5).supported, false);
});
