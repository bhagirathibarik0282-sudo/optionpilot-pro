import test from "node:test";
import assert from "node:assert/strict";
import { getH1RegularMarketWindowContext } from "../h1-regular-market-window-context.js";

function utcForIst(hour: number, minute: number, day = 4): Date {
  const total = hour * 60 + minute - (5 * 60 + 30);
  const h = Math.floor((total + 24 * 60) % (24 * 60) / 60);
  const m = (total + 24 * 60) % 60;
  return new Date(Date.UTC(2026, 8, day, h, m, 0));
}

test("classifies regular 09:15-15:30 IST weekday window without claiming market open", () => {
  for (const [hour, minute] of [[9,15],[12,0],[15,30]] as const) {
    const result = getH1RegularMarketWindowContext(utcForIst(hour, minute));
    assert.equal(result.regularMarketWindowState, "WITHIN_REGULAR_MARKET_WINDOW");
    assert.equal(result.staleEvidenceInterpretation, "REQUIRES_LIVE_EVIDENCE_CHECK");
    assert.equal(result.claimsMarketOpen, false);
    assert.equal(result.holidayCalendarVerified, false);
  }
});

test("outside regular window classifies stale evidence as expected clock-window context", () => {
  for (const [hour, minute] of [[9,14],[15,31],[17,41]] as const) {
    const result = getH1RegularMarketWindowContext(utcForIst(hour, minute));
    assert.equal(result.regularMarketWindowState, "OUTSIDE_REGULAR_MARKET_WINDOW");
    assert.equal(result.staleEvidenceInterpretation, "EXPECTED_OUTSIDE_REGULAR_MARKET_WINDOW");
  }
});

test("Saturday and Sunday remain outside even during regular clock hours", () => {
  for (const day of [5, 6]) {
    const result = getH1RegularMarketWindowContext(utcForIst(12, 0, day));
    assert.equal(result.regularMarketWindowState, "OUTSIDE_REGULAR_MARKET_WINDOW");
    assert.equal(result.staleEvidenceInterpretation, "EXPECTED_OUTSIDE_REGULAR_MARKET_WINDOW");
    assert.equal(result.claimsMarketOpen, false);
    assert.equal(result.holidayCalendarVerified, false);
  }
});

test("context is authority-free and fail-closed", () => {
  const result = getH1RegularMarketWindowContext(utcForIst(17, 41));
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.failClosed, true);
});
