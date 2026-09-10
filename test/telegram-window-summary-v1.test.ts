import test from "node:test";
import assert from "node:assert/strict";
import { buildWindowSummary, buildEodBehaviourSummary } from "../telegram-window-summary-v1.ts";

test("3m summary reports bearish early clue from aligned downside evidence", () => {
  const x = buildWindowSummary({ windowMinutes:3, spotChange:-12, futureChange:-18, ppdSide:"PE", heavyweightUp:2, heavyweightDown:3 });
  assert.equal(x.direction,"BEARISH");
  assert.match(x.text,/3M SUMMARY: Bearish pressure \(early clue\)/);
});

test("insufficient evidence stays not ready", () => {
  const x = buildWindowSummary({ windowMinutes:6, spotChange:null, futureChange:null });
  assert.equal(x.direction,"NOT_READY");
  assert.match(x.text,/WAIT/);
});

test("1h summary uses regime label", () => {
  const x = buildWindowSummary({ windowMinutes:60, spotChange:50, futureChange:65, ppdSide:"CE" });
  assert.equal(x.direction,"BULLISH");
  assert.match(x.text,/1H SUMMARY: Bullish pressure \(regime\)/);
});

test("EOD summary aggregates window behaviour without execution authority", () => {
  const summaries = [
    buildWindowSummary({ windowMinutes:3, spotChange:-10, futureChange:-12, ppdSide:"PE" }),
    buildWindowSummary({ windowMinutes:6, spotChange:-18, futureChange:-20, ppdSide:"PE" }),
    buildWindowSummary({ windowMinutes:15, spotChange:-30, futureChange:-35, ppdSide:"PE" }),
    buildWindowSummary({ windowMinutes:30, spotChange:-44, futureChange:-50, ppdSide:"PE" }),
    buildWindowSummary({ windowMinutes:60, spotChange:-60, futureChange:-70, ppdSide:"PE" }),
  ];
  const text = buildEodBehaviourSummary({ symbol:"NIFTY", summaries, opening:"Gap-down", close:"Bearish close" });
  assert.match(text,/FINAL DAY BEHAVIOUR: BEARISH/);
  assert.match(text,/selector\/execution authority unchanged/);
});
