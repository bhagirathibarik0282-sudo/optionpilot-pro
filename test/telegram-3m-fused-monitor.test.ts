import test from "node:test";
import assert from "node:assert/strict";
import {
  THREE_MINUTE_FUSED_MARKER,
  ThreeMinuteFusedDedup,
  buildThreeMinuteFusedTelegramView,
  isThreeMinuteBoundary,
} from "../telegram-3m-fused-monitor.ts";

test("builds a business-readable bullish fused view without execution authority", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "09:36 IST",
    state: "TRENDING_UP",
    families: [
      { label: "Futures", stance: "BULLISH", verified: true },
      { label: "Premium", stance: "BULLISH", verified: true },
      { label: "OI/PCR", stance: "BULLISH", verified: true },
      { label: "IV/VIX", stance: "NEUTRAL", verified: true },
      { label: "Structure", stance: "BULLISH", verified: true },
    ],
    numeric: { spot: 24050, future: 24072, basis: 22, pcr: 1.02, vix: 11.4, cePremium: 121, pePremium: 98 },
    canonicalAction: "WAIT",
  });
  assert.equal(view.marker, THREE_MINUTE_FUSED_MARKER);
  assert.equal(view.bias, "BULLISH");
  assert.equal(view.createsOrders, false);
  assert.equal(view.affectsExecution, false);
  assert.equal(view.overridesSelector, false);
  assert.match(view.text, /STATE: TRENDING_UP/);
  assert.match(view.text, /Spot 24050\.00/);
  assert.match(view.text, /Action: WAIT/);
});

test("renders exact wall strike and strength without mislabeling strength as OI", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "SENSEX",
    atLabel: "10:09 IST",
    families: [
      { label: "Futures", stance: "NEUTRAL", verified: true },
      { label: "Premium", stance: "NEUTRAL", verified: true },
      { label: "OI/PCR", stance: "NEUTRAL", verified: true },
    ],
    numeric: {
      callWallStrike: 74800,
      callWallStrength: 2.75,
      putWallStrike: 74600,
      putWallStrength: 3.1,
    },
  });
  assert.match(view.text, /CE Wall 74800 • Strength 2\.75/);
  assert.match(view.text, /PE Wall 74600 • Strength 3\.10/);
  assert.doesNotMatch(view.text, /Wall .*\/ OI/);
});

test("missing wall evidence stays unavailable rather than fabricated", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "10:12 IST",
    families: [],
    numeric: {},
  });
  assert.match(view.text, /CE Wall — • Strength — \| PE Wall — • Strength —/);
});

test("missing core families cannot produce a misleading five-star directional call", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "SENSEX",
    atLabel: "09:39 IST",
    families: [
      { label: "Futures", stance: "BULLISH", verified: true },
      { label: "Premium", stance: "PENDING", verified: false },
      { label: "OI/PCR", stance: "PENDING", verified: false },
      { label: "IV/VIX", stance: "PENDING", verified: false },
      { label: "Structure", stance: "PENDING", verified: false },
    ],
  });
  assert.equal(view.bias, "NEUTRAL");
  assert.equal(view.stars, 1);
  assert.match(view.text, /FUSION: NOT READY ★☆☆☆☆/);
});

test("BANKNIFTY renders the same rich view but stays observation only", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "BANKNIFTY",
    atLabel: "10:00 IST",
    state: "RANGE",
    families: [
      { label: "Futures", stance: "BULLISH", verified: true },
      { label: "Premium", stance: "BULLISH", verified: true },
      { label: "OI/PCR", stance: "NEUTRAL", verified: true },
      { label: "IV/VIX", stance: "NEUTRAL", verified: true },
      { label: "Structure", stance: "NEUTRAL", verified: true },
    ],
    canonicalAction: "WAIT",
  });
  assert.match(view.text, /BANKNIFTY observation only/);
  assert.match(view.text, /Action: WAIT/);
  assert.equal(view.createsOrders, false);
});

test("renders verified PPD windows and T0 T3 T6 T15 T30 changes", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "10:06 IST",
    families: [
      { label: "Futures", stance: "BEARISH", verified: true },
      { label: "Premium", stance: "BEARISH", verified: true },
      { label: "OI/PCR", stance: "BEARISH", verified: true },
      { label: "IV/VIX", stance: "NEUTRAL", verified: true },
      { label: "Structure", stance: "BEARISH", verified: true },
    ],
    ppd: [
      { windowMinutes: 3, usable: true, candidateOrientedPpdPp: 4.2, controllingSide: "PE", candidateControlledExpansion: true },
      { windowMinutes: 6, usable: true, candidateOrientedPpdPp: 6.8, controllingSide: "PE", candidateControlledExpansion: true },
      { windowMinutes: 15, usable: true, candidateOrientedPpdPp: 9.1, controllingSide: "PE", candidateControlledExpansion: true },
    ],
    timeline: [
      { label: "T0", spotChange: 0 },
      { label: "T3", spotChange: -12, pcrChange: 0.03 },
      { label: "T6", spotChange: -20, pcrChange: 0.05 },
      { label: "T15", spotChange: -44, pcrChange: 0.08 },
      { label: "T30", spotChange: -61, pcrChange: 0.11 },
    ],
  });
  assert.match(view.text, /PPD: 3m \+4\.20pp PE ✓ \| 6m \+6\.80pp PE ✓ \| 15m \+9\.10pp PE ✓/);
  for (const label of ["T0:", "T3:", "T6:", "T15:", "T30:"]) assert.match(view.text, new RegExp(label));
});

test("dedup suppresses unchanged semantic fusion for the same symbol", () => {
  const dedup = new ThreeMinuteFusedDedup();
  const input = { symbol: "NIFTY" as const, atLabel: "09:42 IST", families: [{ label: "Premium", stance: "BEARISH" as const, verified: true }], canonicalAction: "WAIT" as const };
  const first = buildThreeMinuteFusedTelegramView(input);
  const second = buildThreeMinuteFusedTelegramView({ ...input, atLabel: "09:45 IST" });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(dedup.shouldEmit(first), true);
  assert.equal(dedup.shouldEmit(second), false);
});

test("3-minute boundary follows IST minute modulo three", () => {
  assert.equal(isThreeMinuteBoundary(new Date("2026-09-10T04:06:00.000Z")), true);
  assert.equal(isThreeMinuteBoundary(new Date("2026-09-10T04:07:00.000Z")), false);
});
