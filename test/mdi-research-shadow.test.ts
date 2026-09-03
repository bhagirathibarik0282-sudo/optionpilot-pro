import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiResearchShadow } from "../mdi-research-shadow.js";

const base = {
  ts: "2026-09-03T03:45:00.000Z",
  fullPcr: 0.80,
  band7Pcr: 0.85,
  callWallStrike: 24000,
  putWallStrike: 23800,
  callWallStrength: 100,
  putWallStrength: 100,
  ceIv: 12,
  peIv: 12,
  indiaVix: 12,
  futureLtp: 23900,
};

test("bullish-aligned changes produce positive MDI", () => {
  const out = deriveMdiResearchShadow({
    previous: base,
    current: {
      ...base,
      ts: "2026-09-03T03:51:00.000Z",
      fullPcr: 0.95,
      band7Pcr: 1.00,
      callWallStrike: 24050,
      putWallStrike: 23850,
      callWallStrength: 90,
      putWallStrength: 120,
      ceIv: 15,
      peIv: 12,
      indiaVix: 11.4,
      futureLtp: 23990,
    },
    strikeStep: 50,
  });
  assert.ok(out.mdi !== null && out.mdi > 25);
  assert.match(out.bias, /BULLISH/);
});

test("bearish-aligned changes produce negative MDI", () => {
  const out = deriveMdiResearchShadow({
    previous: base,
    current: {
      ...base,
      ts: "2026-09-03T03:51:00.000Z",
      fullPcr: 0.65,
      band7Pcr: 0.70,
      callWallStrike: 23950,
      putWallStrike: 23750,
      callWallStrength: 120,
      putWallStrength: 85,
      ceIv: 12,
      peIv: 15,
      indiaVix: 12.8,
      futureLtp: 23810,
    },
    strikeStep: 50,
  });
  assert.ok(out.mdi !== null && out.mdi < -25);
  assert.match(out.bias, /BEARISH/);
});

test("low evidence coverage fails closed", () => {
  const out = deriveMdiResearchShadow({
    previous: { ts: base.ts, futureLtp: 23900 },
    current: { ts: "2026-09-03T03:51:00.000Z", futureLtp: 23910 },
    strikeStep: 50,
  });
  assert.equal(out.mdi, null);
  assert.equal(out.bias, "UNAVAILABLE");
  assert.ok(out.coveragePct < 60);
});

test("MDI shadow has no live authority", () => {
  const out = deriveMdiResearchShadow({ previous: base, current: base, strikeStep: 50 });
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_SHADOW_ONLY");
});
