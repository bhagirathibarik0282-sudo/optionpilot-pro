import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiResearchShadow, type MdiSourceQualityMap } from "../mdi-research-shadow.js";

const verified: MdiSourceQualityMap = {
  PCR: "VERIFIED",
  WALL: "VERIFIED",
  IV: "VERIFIED",
  VIX: "VERIFIED",
  FUTURES: "VERIFIED",
};

const base = {
  ts: "2026-09-03T03:45:00.000Z",
  sourceQuality: verified,
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

test("bullish-aligned VERIFIED changes produce positive MDI", () => {
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
  assert.equal(out.sourcePolicy, "VERIFIED_COMPONENT_SOURCES_ONLY");
});

test("bearish-aligned VERIFIED changes produce negative MDI", () => {
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

test("low VERIFIED evidence coverage fails closed", () => {
  const out = deriveMdiResearchShadow({
    previous: { ts: base.ts, sourceQuality: verified, futureLtp: 23900 },
    current: { ts: "2026-09-03T03:51:00.000Z", sourceQuality: verified, futureLtp: 23910 },
    strikeStep: 50,
  });
  assert.equal(out.mdi, null);
  assert.equal(out.bias, "UNAVAILABLE");
  assert.ok(out.coveragePct < 60);
});

test("proxy component is excluded even when numeric values exist", () => {
  const previous = {
    ...base,
    sourceQuality: { ...verified, PCR: "PROXY" as const },
  };
  const current = {
    ...base,
    ts: "2026-09-03T03:51:00.000Z",
    sourceQuality: { ...verified, PCR: "PROXY" as const },
    fullPcr: 1.20,
    band7Pcr: 1.25,
  };
  const out = deriveMdiResearchShadow({ previous, current, strikeStep: 50 });
  const pcr = out.components.find((x) => x.name === "PCR_VELOCITY");
  assert.equal(pcr?.score, null);
  assert.match(pcr?.reason ?? "", /PROXY/);
});

test("mixed stale/degraded/unknown quality can force whole MDI unavailable", () => {
  const blocked: MdiSourceQualityMap = {
    PCR: "PROXY",
    WALL: "STALE",
    IV: "DEGRADED",
    VIX: "UNKNOWN",
    FUTURES: "VERIFIED",
  };
  const out = deriveMdiResearchShadow({
    previous: { ...base, sourceQuality: blocked },
    current: { ...base, ts: "2026-09-03T03:51:00.000Z", sourceQuality: blocked, futureLtp: 23910 },
    strikeStep: 50,
  });
  assert.equal(out.mdi, null);
  assert.equal(out.bias, "UNAVAILABLE");
  assert.equal(out.coveragePct, 25);
});

test("quality mismatch between previous and current blocks the component", () => {
  const out = deriveMdiResearchShadow({
    previous: base,
    current: {
      ...base,
      ts: "2026-09-03T03:51:00.000Z",
      sourceQuality: { ...verified, WALL: "DEGRADED" },
      callWallStrike: 24050,
      putWallStrike: 23850,
    },
    strikeStep: 50,
  });
  const wall = out.components.find((x) => x.name === "WALL_MIGRATION");
  assert.equal(wall?.score, null);
  assert.match(wall?.reason ?? "", /DEGRADED/);
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
