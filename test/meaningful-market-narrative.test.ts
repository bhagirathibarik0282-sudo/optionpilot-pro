import test from "node:test";
import assert from "node:assert/strict";
import {
  attributeMarketFootprint,
  buildMeaningfulMarketNarrative,
  formatNumericTransition,
  PerIndexNarrativeMemory,
  type FootprintEvent,
} from "../meaningful-market-narrative.ts";

function ev(source: FootprintEvent["source"], at: number, role: FootprintEvent["role"] = "SUPPORTS_LOCKED_DIRECTION"): FootprintEvent {
  return { source, observedAtMs: at, meaningful: true, fresh: true, role };
}

test("OI/wall lead is attributed when it is first verified support before spot", () => {
  const r = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("OI_WALL", 1), ev("HEAVYWEIGHT_BANK", 2), ev("FUTURES", 3), ev("SPOT", 4), ev("CURRENT_DTE_PREMIUM", 5), ev("NEXT_DTE_PREMIUM", 6)],
  });
  assert.equal(r.leader, "OI_WALL_LED");
  assert.equal(r.classification, "OI_WALL_LED");
  assert.deepEqual(r.leadChain.slice(0, 4), ["OI_WALL", "HEAVYWEIGHT_BANK", "FUTURES", "SPOT"]);
  assert.equal(r.semantics, "OBSERVED_SEQUENCE_NOT_CAUSAL_CLAIM");
});

test("heavyweight/bank lead is attributed without calling missing OI a conflict", () => {
  const r = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("HEAVYWEIGHT_BANK", 1), ev("FUTURES", 2), ev("SPOT", 3)],
  });
  assert.equal(r.leader, "HEAVYWEIGHT_BANK_LED");
  assert.equal(r.reason, "HEAVYWEIGHT_BANK_WAS_FIRST_VERIFIED_SUPPORT_BEFORE_SPOT");
});

test("futures can lead spot", () => {
  const r = attributeMarketFootprint({
    symbol: "SENSEX",
    lockedDirection: "BEARISH",
    previousLeader: null,
    events: [ev("FUTURES", 1), ev("SPOT", 2), ev("CURRENT_DTE_PREMIUM", 3)],
  });
  assert.equal(r.leader, "FUTURES_LED");
});

test("premium lead requires next-DTE confirmation to be called cross-DTE confirmed", () => {
  const confirmed = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("CURRENT_DTE_PREMIUM", 1), ev("SPOT", 2), ev("NEXT_DTE_PREMIUM", 3)],
  });
  assert.equal(confirmed.leader, "PREMIUM_LED_CROSS_DTE_CONFIRMED");

  const currentOnly = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("CURRENT_DTE_PREMIUM", 1), ev("SPOT", 2)],
  });
  assert.equal(currentOnly.leader, "CURRENT_DTE_ONLY_NON_CONFIRMED");
});

test("footprint rotation is explicit and retains the new leader", () => {
  const r = attributeMarketFootprint({
    symbol: "BANKNIFTY",
    lockedDirection: "BEARISH",
    previousLeader: "OI_WALL_LED",
    events: [ev("FUTURES", 1), ev("SPOT", 2)],
  });
  assert.equal(r.classification, "FOOTPRINT_ROTATION");
  assert.equal(r.rotationDetected, true);
  assert.equal(r.rotationFrom, "OI_WALL_LED");
  assert.equal(r.leader, "FUTURES_LED");
});

test("stale evidence is ignored and lack of spot follow-through remains unresolved", () => {
  const stale = ev("OI_WALL", 1);
  stale.fresh = false;
  const r = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [stale, ev("FUTURES", 2)],
  });
  assert.equal(r.leader, "UNRESOLVED");
  assert.equal(r.reason, "NO_MEANINGFUL_SPOT_FOLLOW_THROUGH_YET");
});

test("opposing evidence is described as drag rather than generic conflict", () => {
  const r = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("OI_WALL", 1), ev("SPOT", 2), ev("HEAVYWEIGHT_BANK", 3, "OPPOSES_LOCKED_DIRECTION")],
  });
  assert.equal(r.leader, "OI_WALL_LED");
  assert.deepEqual(r.opposingSources, ["HEAVYWEIGHT_BANK"]);
});

test("numeric transition always shows raw previous/current, absolute change, arrow and percent", () => {
  const text = formatNumericTransition({ previous: 24080, current: 24138, valueDecimals: 0, deltaDecimals: 0, percentDecimals: 2 });
  assert.equal(text, "24,080→24,138 ↑ +58 (+0.24%)");

  const pcr = formatNumericTransition({ previous: 0.841, current: 1.028, valueDecimals: 3, deltaDecimals: 3, percentDecimals: 1, useGrouping: false });
  assert.equal(pcr, "0.841→1.028 ↑ +0.187 (+22.2%)");
});

test("meaningful narrative links previous message and bolds candidate + footprint", () => {
  const footprint = attributeMarketFootprint({
    symbol: "NIFTY",
    lockedDirection: "BULLISH",
    previousLeader: null,
    events: [ev("OI_WALL", 1), ev("FUTURES", 2), ev("SPOT", 3), ev("CURRENT_DTE_PREMIUM", 4), ev("NEXT_DTE_PREMIUM", 5)],
  });
  const r = buildMeaningfulMarketNarrative({
    symbol: "NIFTY",
    at: "14:45 IST",
    state: "BULLISH_RELEASE",
    dataQuality: "OK",
    previous: { at: "14:30", state: "BULLISH_TRANSITION" },
    price: { previous: 24080, current: 24138, valueDecimals: 0, deltaDecimals: 0 },
    futures: { previous: 24110, current: 24178, valueDecimals: 0, deltaDecimals: 0 },
    metrics: [
      { label: "PCR", transition: { previous: 0.841, current: 1.028, valueDecimals: 3, deltaDecimals: 3, percentDecimals: 1, useGrouping: false } },
      { label: "CW", transition: { previous: 465.8, current: 285.9, valueDecimals: 1, deltaDecimals: 1, percentDecimals: 1, suffix: "L" }, state: "SHEDDING", bold: true },
    ],
    candidate: { label: "24050 CE • DTE1", transition: { previous: 21.8, current: 31.5, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1 }, state: "HH" },
    opposite: { label: "24000 PE", transition: { previous: 12.1, current: 14.8, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1 }, state: "LL FAILURE" },
    meaningfulChanges: ["BULLISH TRANSITION → BULLISH RELEASE", "CALL WALL SHEDDING FAST"],
    footprint,
  });
  assert.match(r.text, /Linked: 14:30 \*\*BULLISH TRANSITION\*\*/);
  assert.match(r.text, /NIFTY 24,080→24,138 ↑ \+58 \(\+0\.24%\)/);
  assert.match(r.text, /\*\*CANDIDATE: 24050 CE • DTE1\*\*/);
  assert.match(r.text, /\*\*FOOTPRINT: OI_WALL_LED\*\*/);
  assert.doesNotMatch(r.text, /DATA CONFLICTING/i);
  assert.equal(r.canInventNumbers, false);
  assert.equal(r.affectsExecution, false);
});

test("per-index memory is isolated and rejects out-of-order meaningful messages", () => {
  const memory = new PerIndexNarrativeMemory();
  memory.commit({
    symbol: "NIFTY",
    state: "BULLISH_RELEASE",
    stateSinceMs: 100,
    lastMeaningfulAtMs: 100,
    lastMessageId: "n1",
    candidateKey: "24050CE",
    oppositeKey: "24000PE",
    footprintLeader: "OI_WALL_LED",
    fingerprint: "nifty-fp",
  });
  memory.commit({
    symbol: "SENSEX",
    state: "BEARISH_PRESSURE",
    stateSinceMs: 110,
    lastMeaningfulAtMs: 110,
    lastMessageId: "s1",
    candidateKey: "PE",
    oppositeKey: "CE",
    footprintLeader: "FUTURES_LED",
    fingerprint: "sensex-fp",
  });

  assert.equal(memory.get("NIFTY")?.lastMessageId, "n1");
  assert.equal(memory.get("SENSEX")?.lastMessageId, "s1");
  assert.equal(memory.get("BANKNIFTY"), null);

  assert.throws(() => memory.commit({
    symbol: "NIFTY",
    state: "EXHAUSTION_WATCH",
    stateSinceMs: 90,
    lastMeaningfulAtMs: 90,
    lastMessageId: "n0",
    candidateKey: "24050CE",
    oppositeKey: "24000PE",
    footprintLeader: "FUTURES_LED",
    fingerprint: "old",
  }), /OUT_OF_ORDER_MEANINGFUL_MESSAGE/);
});
