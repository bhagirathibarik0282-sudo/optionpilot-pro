import test from "node:test";
import assert from "node:assert/strict";
import { resetWatchZScoreForTests, updateWatchZScore } from "../telegram-watch-zscore-v1.ts";

test("Z watch fails closed until baseline is ready", () => {
  resetWatchZScoreForTests();
  const r = updateWatchZScore({ symbol: "NIFTY", spot3m: 1, cePremium3m: 1, pePremium3m: -1, ppd3m: 1, ppdSide: "CE" });
  assert.equal(r.ready, false);
  assert.equal(r.watchSide, null);
  assert.match(r.note, /Z NOT READY/);
});

test("Z watch promotes CE only after abnormal aligned bullish pressure", () => {
  resetWatchZScoreForTests();
  for (let i = 0; i < 12; i++) {
    const noise = (i % 3) - 1;
    updateWatchZScore({ symbol: "NIFTY", spot3m: noise, cePremium3m: noise * 0.4, pePremium3m: -noise * 0.3, ppd3m: Math.abs(noise) * 0.3, ppdSide: noise >= 0 ? "CE" : "PE" });
  }
  const r = updateWatchZScore({ symbol: "NIFTY", spot3m: 8, cePremium3m: 6, pePremium3m: -5, ppd3m: 7, ppdSide: "CE" });
  assert.equal(r.ready, true);
  assert.equal(r.watchSide, "CE");
  assert.ok((r.directionalScore ?? 0) > 0.75);
});

test("OI PCR VIX and spread receive Z normalization but do not become directional votes by themselves", () => {
  resetWatchZScoreForTests();
  for (let i = 0; i < 12; i++) updateWatchZScore({ symbol: "SENSEX", ceOi3m: i, peOi3m: i + 1, pcr3m: i / 100, vix3m: i / 10, spreadPct: 0.2 + i / 100 });
  const r = updateWatchZScore({ symbol: "SENSEX", ceOi3m: 99, peOi3m: 120, pcr3m: 2, vix3m: 5, spreadPct: 2 });
  assert.equal(r.ready, false);
  assert.equal(r.watchSide, null);
  assert.ok(r.metrics.pcr3m.z !== null);
  assert.ok(r.metrics.spreadPct.z !== null);
});
