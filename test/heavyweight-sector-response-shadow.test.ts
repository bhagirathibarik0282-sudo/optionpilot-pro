import test from "node:test";
import assert from "node:assert/strict";
import { deriveHeavyweightSectorResponse } from "../heavyweight-sector-response-shadow.js";
import type { TemporalEvidenceSnapshot } from "../temporal-evidence-fusion.js";

function snap(timeframe: "3M"|"6M"|"15M"|"30M", direction: "UP"|"DOWN"|"FLAT", state: TemporalEvidenceSnapshot["state"] = "STRENGTHENING"): TemporalEvidenceSnapshot {
  return {
    symbol: "X",
    timeframe,
    blockEnd: "2026-09-03T04:00:00.000Z",
    previousBlockEnd: "2026-09-03T03:57:00.000Z",
    state,
    direction,
    currentReturnPct: direction === "UP" ? 0.2 : direction === "DOWN" ? -0.2 : 0,
    previousReturnPct: direction === "UP" ? 0.1 : direction === "DOWN" ? -0.1 : 0,
    currentRangePct: 0.3,
    previousRangePct: 0.2,
    currentCoveragePct: 100,
    previousCoveragePct: 100,
    reasons: [],
    ruleVersion: "TEF_FOUNDATION_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

test("heavyweight can lead before sector confirmation", () => {
  const out = deriveHeavyweightSectorResponse([
    { symbol: "HDFC", weightPct: 12, windows: { clue3m: snap("3M", "UP"), confirm6m: snap("6M", "UP") } },
  ], [
    { sector: "BANK", windows: { clue3m: snap("3M", "UP") } },
  ]);
  assert.equal(out.heavyweights[0].roleState, "CONFIRMING");
  assert.equal(out.sectors[0].state, "EARLY_RESPONSE");
  assert.equal(out.transition, "HEAVYWEIGHT_LEADS");
});

test("sector confirmation is detected after 15m and 30m alignment", () => {
  const out = deriveHeavyweightSectorResponse([
    { symbol: "ICICI", weightPct: 10, windows: { clue3m: snap("3M", "UP"), confirm6m: snap("6M", "UP"), validate15m: snap("15M", "UP") } },
  ], [
    { sector: "BANK", windows: { clue3m: snap("3M", "UP"), confirm6m: snap("6M", "UP"), validate15m: snap("15M", "UP"), sustain30m: snap("30M", "UP") } },
  ]);
  assert.equal(out.sectors[0].state, "SUSTAINED_RESPONSE");
  assert.equal(out.transition, "SECTOR_CONFIRMS");
});

test("heavyweight and sector opposite directions are divergent", () => {
  const out = deriveHeavyweightSectorResponse([
    { symbol: "RELIANCE", windows: { clue3m: snap("3M", "UP"), confirm6m: snap("6M", "UP") } },
  ], [
    { sector: "ENERGY", windows: { clue3m: snap("3M", "DOWN"), confirm6m: snap("6M", "DOWN") } },
  ]);
  assert.equal(out.transition, "DIVERGENT");
});

test("shadow engine has no live authority", () => {
  const out = deriveHeavyweightSectorResponse([], []);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_SHADOW_ONLY");
});
