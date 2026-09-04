import test from "node:test";
import assert from "node:assert/strict";
import { evaluateH1MarketOpenReadinessAcceptance } from "../h1-market-open-readiness-acceptance.js";
import { getH1RegularMarketWindowContext } from "../h1-regular-market-window-context.js";

function statusAt(now: Date, overrides: Partial<{
  connected: boolean;
  socketState: "OPEN" | "UNAVAILABLE";
  readOnlyConsumerReadySymbolCount: number;
  readOnlyDirectionReadySymbolCount: number;
  readOnlyShadowInputReadySymbolCount: number;
}> = {}) {
  return {
    marketWindowContext: getH1RegularMarketWindowContext(now),
    connected: overrides.connected ?? false,
    socketState: overrides.socketState ?? "UNAVAILABLE",
    readOnlyConsumerReadySymbolCount: overrides.readOnlyConsumerReadySymbolCount ?? 0,
    readOnlyDirectionReadySymbolCount: overrides.readOnlyDirectionReadySymbolCount ?? 0,
    readOnlyShadowInputReadySymbolCount: overrides.readOnlyShadowInputReadySymbolCount ?? 0,
  } as const;
}

test("outside regular window is contextual, not a live-readiness failure", () => {
  const out = evaluateH1MarketOpenReadinessAcceptance(statusAt(new Date("2026-09-04T12:21:00.000Z")));
  assert.equal(out.state, "OUTSIDE_REGULAR_WINDOW");
  assert.deepEqual(out.blockers, ["OUTSIDE_REGULAR_MARKET_WINDOW"]);
});

test("inside regular window fails closed until live read-only chain is ready", () => {
  const out = evaluateH1MarketOpenReadinessAcceptance(statusAt(new Date("2026-09-04T05:00:00.000Z")));
  assert.equal(out.state, "BLOCKED");
  assert.deepEqual(out.blockers, ["LIVE_SOCKET_NOT_OPEN", "NO_CONSUMER_READY_SYMBOL", "NO_DIRECTION_READY_SYMBOL", "NO_SHADOW_INPUT_READY_SYMBOL"]);
});

test("inside regular window passes when at least one exact read-only symbol chain is ready", () => {
  const out = evaluateH1MarketOpenReadinessAcceptance(statusAt(new Date("2026-09-04T05:00:00.000Z"), {
    connected: true,
    socketState: "OPEN",
    readOnlyConsumerReadySymbolCount: 1,
    readOnlyDirectionReadySymbolCount: 1,
    readOnlyShadowInputReadySymbolCount: 1,
  }));
  assert.equal(out.state, "PASS");
  assert.deepEqual(out.blockers, []);
  assert.equal(out.claimsMarketOpen, false);
  assert.equal(out.holidayCalendarVerified, false);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.forwardsDownstream, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});
