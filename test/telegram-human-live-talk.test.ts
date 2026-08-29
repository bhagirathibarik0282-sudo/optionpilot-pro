import test from "node:test";
import assert from "node:assert/strict";
import { buildHumanLiveTalk } from "../telegram-human-live-talk.js";

test("READY uses direct human-like wording without changing authority", () => {
  const out = buildHumanLiveTalk({
    style: "SCALP",
    symbol: "NIFTY",
    side: "CE",
    state: "READY",
    verdictLocked: true,
    verifiedFacts: ["Spot and futures participation are aligned.", "CE premium is responding."],
  });
  assert.match(out.text, /NIFTY: the scalp setup is ready on CE/);
  assert.match(out.text, /Spot and futures participation are aligned/);
  assert.equal(out.canChangeVerdict, false);
  assert.equal(out.canInventNumbers, false);
});

test("WATCH cannot sound executable", () => {
  const out = buildHumanLiveTalk({
    style: "SWING",
    symbol: "BANKNIFTY",
    side: "PE",
    state: "WATCH",
    verdictLocked: true,
    verifiedFacts: ["Higher-timeframe confirmation is incomplete."],
  });
  assert.match(out.text, /not ready yet/);
  assert.doesNotMatch(out.text, /setup is ready on PE/);
});

test("BLOCKED explicitly tells user to stay out", () => {
  const out = buildHumanLiveTalk({
    style: "TRADE",
    symbol: "SENSEX",
    side: "NONE",
    state: "BLOCKED",
    verdictLocked: true,
    verifiedFacts: ["Liquidity gate failed."],
  });
  assert.match(out.text, /stay out for now/);
  assert.match(out.text, /Liquidity gate failed/);
});

test("DATA_UNAVAILABLE refuses to call a trade", () => {
  const out = buildHumanLiveTalk({
    style: "SCALP",
    symbol: "NIFTY",
    side: "NONE",
    state: "DATA_UNAVAILABLE",
    verdictLocked: true,
    verifiedFacts: [],
  });
  assert.match(out.text, /do not have enough reliable live evidence/);
});

test("empty symbol fails closed", () => {
  assert.throws(() => buildHumanLiveTalk({
    style: "SCALP",
    symbol: " ",
    side: "CE",
    state: "READY",
    verdictLocked: true,
    verifiedFacts: [],
  }), /symbol is required/);
});
