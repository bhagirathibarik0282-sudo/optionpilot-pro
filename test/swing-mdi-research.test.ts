import test from "node:test";
import assert from "node:assert/strict";
import { deriveSwingMdiResearch } from "../swing-mdi-research.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";

const verified: MdiSourceQualityMap = { PCR: "VERIFIED", WALL: "VERIFIED", IV: "VERIFIED", VIX: "VERIFIED", FUTURES: "VERIFIED" };

function input(prev: number, curr: number): MdiInput {
  return {
    previous: {
      ts: "2026-09-01T03:45:00.000Z",
      sourceQuality: verified,
      fullPcr: 0.8 + prev * 0.001,
      band7Pcr: 0.85 + prev * 0.001,
      callWallStrike: 24000 + prev,
      putWallStrike: 23800 + prev,
      callWallStrength: 100,
      putWallStrength: 100,
      ceIv: 12 + Math.max(prev, 0) * 0.01,
      peIv: 12 + Math.max(-prev, 0) * 0.01,
      indiaVix: 12,
      futureLtp: 23900 + prev,
    },
    current: {
      ts: "2026-09-01T03:51:00.000Z",
      sourceQuality: verified,
      fullPcr: 0.8 + curr * 0.001,
      band7Pcr: 0.85 + curr * 0.001,
      callWallStrike: 24000 + curr,
      putWallStrike: 23800 + curr,
      callWallStrength: curr >= prev ? 90 : 110,
      putWallStrength: curr >= prev ? 115 : 90,
      ceIv: 12 + Math.max(curr, 0) * 0.01,
      peIv: 12 + Math.max(-curr, 0) * 0.01,
      indiaVix: curr >= prev ? 11.5 : 12.5,
      futureLtp: 23900 + curr,
    },
    strikeStep: 50,
  };
}

test("multi-session bullish persistence is derived only from internally derived MDI", () => {
  const out = deriveSwingMdiResearch([
    { tradeDate: "2026-08-28", mdiInput: input(0, 40) },
    { tradeDate: "2026-08-31", mdiInput: input(0, 45) },
    { tradeDate: "2026-09-01", mdiInput: input(0, 50) },
    { tradeDate: "2026-09-02", mdiInput: input(0, 55) },
    { tradeDate: "2026-09-03", mdiInput: input(0, 60) },
  ]);
  const five = out.windows.find((w) => w.sessions === 5)!;
  assert.equal(five.usableSessions, 5);
  assert.equal(five.bias, "BULLISH_PERSISTENCE");
  assert.ok((five.slopePerSession ?? 0) >= 0);
});

test("unverified daily MDI sessions are excluded rather than proxied", () => {
  const bad = input(0, 50);
  bad.current.sourceQuality = { ...verified, PCR: "PROXY", WALL: "STALE", IV: "DEGRADED" };
  const out = deriveSwingMdiResearch([
    { tradeDate: "2026-09-01", mdiInput: bad },
    { tradeDate: "2026-09-02", mdiInput: input(0, 45) },
    { tradeDate: "2026-09-03", mdiInput: input(0, 55) },
  ]);
  const three = out.windows.find((w) => w.sessions === 3)!;
  assert.equal(three.availableSessions, 3);
  assert.ok(three.usableSessions < three.availableSessions);
  assert.ok(three.reasons.some((r) => r.includes("excluded")));
});

test("duplicate trade dates do not double-count a session", () => {
  const out = deriveSwingMdiResearch([
    { tradeDate: "2026-09-01", mdiInput: input(0, 45) },
    { tradeDate: "2026-09-01", mdiInput: input(0, -45) },
    { tradeDate: "2026-09-02", mdiInput: input(0, 50) },
    { tradeDate: "2026-09-03", mdiInput: input(0, 55) },
  ]);
  const three = out.windows.find((w) => w.sessions === 3)!;
  assert.equal(three.availableSessions, 3);
});

test("swing MDI remains research-only with zero live authority", () => {
  const out = deriveSwingMdiResearch([]);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "MULTI_DAY_RESEARCH_ONLY");
  assert.equal(out.sourcePolicy, "DERIVE_FROM_VERIFIED_MDI_INPUTS_ONLY");
});
