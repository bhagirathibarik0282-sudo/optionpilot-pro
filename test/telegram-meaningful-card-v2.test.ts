import test from "node:test";
import assert from "node:assert/strict";
import { buildMeaningfulTelegramCardV2 } from "../telegram-meaningful-card-v2.js";

test("renders compact meaningful transition card with candidate/opposite/PCR/walls", () => {
  const text = buildMeaningfulTelegramCardV2({
    symbol: "NIFTY",
    at: "14:18 IST",
    direction: "BEARISH",
    state: "BEARISH_TRANSITION",
    spotPrevious: 24042,
    spotCurrent: 24018,
    futurePrevious: 24066,
    futureCurrent: 24042,
    pdh: 24185,
    pdl: 23985,
    candidateStrike: 23950,
    candidateSide: "PE",
    candidatePrevious: 124,
    candidateCurrent: 141.2,
    candidateDte: 2,
    oppositeStrike: 24050,
    oppositeSide: "CE",
    oppositePrevious: 118,
    oppositeCurrent: 92,
    pcrPrevious: 0.74,
    pcrCurrent: 0.82,
    callWallStrike: 24100,
    callWallOiPrevious: 25733000,
    callWallOiCurrent: 17772000,
    putWallStrike: 24000,
    putWallOiPrevious: 23121000,
    putWallOiCurrent: 24525000,
    nextDtePrevious: 132,
    nextDteCurrent: 146,
    meaningfulChanges: ["OBSERVING → BEARISH TRANSITION", "NEXT-DTE JOINED"],
  });

  assert.match(text, /🔴 NIFTY \| 14:18 IST \| BEARISH TRANSITION/);
  assert.match(text, /🎯 Candidate: 23950 PE \| DTE2/);
  assert.match(text, /↔️ Opposite: 24050 CE/);
  assert.match(text, /🧱 CE Wall 24100/);
  assert.match(text, /🧱 PE Wall 24000/);
  assert.match(text, /📊 PCR: 0\.740 → 0\.820 ↑/);
  assert.match(text, /🛒 CART: 23950 PE — WATCH ONLY/);
});

test("does not invent unavailable optional data", () => {
  const text = buildMeaningfulTelegramCardV2({
    symbol: "NIFTY",
    at: "10:00 IST",
    direction: "NEUTRAL",
    state: "OBSERVING",
    spotPrevious: 24000,
    spotCurrent: 24000,
    candidateStrike: 24000,
    candidateSide: "CE",
    candidatePrevious: 100,
    candidateCurrent: 100,
  });

  assert.doesNotMatch(text, /Futures:/);
  assert.doesNotMatch(text, /PCR:/);
  assert.doesNotMatch(text, /CE Wall/);
  assert.doesNotMatch(text, /Opposite:/);
});
