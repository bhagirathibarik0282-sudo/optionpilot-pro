import test from "node:test";
import assert from "node:assert/strict";
import {
  THREE_MINUTE_FUSED_MARKER,
  ThreeMinuteFusedDedup,
  buildThreeMinuteFusedTelegramView,
  isThreeMinuteBoundary,
} from "../telegram-3m-fused-monitor.ts";

test("builds a monitor-only bullish fused view without execution authority", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "09:36 IST",
    families: [
      { label: "Futures", stance: "BULLISH", verified: true, detail: "basis supportive" },
      { label: "Premium", stance: "BULLISH", verified: true, detail: "CE expanding" },
      { label: "OI/PCR", stance: "BULLISH", verified: true, detail: "put wall stronger" },
      { label: "IV/Skew", stance: "NEUTRAL", verified: true },
      { label: "Heavyweights", stance: "PENDING", verified: false },
    ],
    canonicalAction: "WAIT",
  });

  assert.equal(view.marker, THREE_MINUTE_FUSED_MARKER);
  assert.equal(view.bias, "BULLISH");
  assert.equal(view.canonicalAction, "WAIT");
  assert.equal(view.createsOrders, false);
  assert.equal(view.affectsExecution, false);
  assert.equal(view.overridesSelector, false);
  assert.match(view.text, /OPTIONPILOT 3M FUSED VIEW/);
  assert.match(view.text, /Canonical: WAIT/);
  assert.match(view.text, /Monitor only/);
});

test("does not convert missing families into directional votes", () => {
  const view = buildThreeMinuteFusedTelegramView({
    symbol: "SENSEX",
    atLabel: "09:39 IST",
    families: [
      { label: "Futures", stance: "PENDING", verified: false },
      { label: "Premium", stance: "PENDING", verified: false },
    ],
  });
  assert.equal(view.bias, "NEUTRAL");
  assert.equal(view.stars, 1);
  assert.equal(view.verifiedFamilyCount, 0);
  assert.equal(view.pendingFamilyCount, 2);
});

test("dedup suppresses unchanged semantic fusion for the same symbol", () => {
  const dedup = new ThreeMinuteFusedDedup();
  const input = {
    symbol: "NIFTY" as const,
    atLabel: "09:42 IST",
    families: [{ label: "Premium", stance: "BEARISH" as const, verified: true }],
    canonicalAction: "WAIT" as const,
  };
  const first = buildThreeMinuteFusedTelegramView(input);
  const second = buildThreeMinuteFusedTelegramView({ ...input, atLabel: "09:45 IST" });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(dedup.shouldEmit(first), true);
  assert.equal(dedup.shouldEmit(second), false);
});

test("canonical candidate rotation changes the dedup fingerprint", () => {
  const a = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "10:00 IST",
    families: [{ label: "Premium", stance: "BULLISH", verified: true }],
    canonicalAction: "BUY_CE",
    canonicalCandidateKey: "NIFTY|2026-09-15|23450|CE",
  });
  const b = buildThreeMinuteFusedTelegramView({
    symbol: "NIFTY",
    atLabel: "10:03 IST",
    families: [{ label: "Premium", stance: "BULLISH", verified: true }],
    canonicalAction: "BUY_CE",
    canonicalCandidateKey: "NIFTY|2026-09-15|23500|CE",
  });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("3-minute boundary follows IST minute modulo three", () => {
  assert.equal(isThreeMinuteBoundary(new Date("2026-09-10T04:06:00.000Z")), true); // 09:36 IST
  assert.equal(isThreeMinuteBoundary(new Date("2026-09-10T04:07:00.000Z")), false); // 09:37 IST
});
