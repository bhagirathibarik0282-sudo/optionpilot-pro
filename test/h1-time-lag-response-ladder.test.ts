import test from "node:test";
import assert from "node:assert/strict";
import { buildH1TimeLagResponseLadder } from "../h1-time-lag-response-ladder.js";
import type { TemporalEvidenceSnapshot } from "../temporal-evidence-fusion.js";

function row(timeframe: TemporalEvidenceSnapshot["timeframe"], direction: TemporalEvidenceSnapshot["direction"], state: TemporalEvidenceSnapshot["state"], blockEnd: string): TemporalEvidenceSnapshot {
  return {
    symbol: "NIFTY",
    timeframe,
    blockEnd,
    previousBlockEnd: null,
    state,
    direction,
    currentReturnPct: direction === "UP" ? 0.1 : direction === "DOWN" ? -0.1 : 0,
    previousReturnPct: 0.08,
    currentRangePct: 0.2,
    previousRangePct: 0.15,
    currentCoveragePct: 100,
    previousCoveragePct: 100,
    reasons: [],
    ruleVersion: "TEF_FOUNDATION_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

const aligned = [
  row("3M", "UP", "STRENGTHENING", "2026-09-04T09:33:00.000Z"),
  row("6M", "UP", "STABLE", "2026-09-04T09:30:00.000Z"),
  row("15M", "UP", "STABLE", "2026-09-04T09:30:00.000Z"),
  row("30M", "UP", "STABLE", "2026-09-04T09:30:00.000Z"),
];

test("confirms the frozen 3m/6m/15m/30m ladder without causal lag claims", () => {
  const result = buildH1TimeLagResponseLadder(aligned);
  assert.equal(result.ready, true);
  assert.equal(result.anchorDirection, "UP");
  assert.equal(result.highestConfirmedStage, "SUSTAINED_REGIME_CONFIRMATION");
  assert.equal(result.causalLagAvailable, false);
  assert.ok(result.stages.every((x) => x.confirmed));
  assert.equal(result.stages.find((x) => x.timeframe === "6M")?.observedBlockEndOffsetMinutesFrom3m, -3);
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.readOnly, true);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("stops confirmation chain when a later timeframe conflicts", () => {
  const inputs = aligned.map((x) => ({ ...x }));
  inputs[2].direction = "DOWN";
  const result = buildH1TimeLagResponseLadder(inputs);
  assert.equal(result.ready, true);
  assert.equal(result.highestConfirmedStage, "INITIAL_CONFIRMATION");
  assert.equal(result.stages.find((x) => x.timeframe === "15M")?.confirmed, false);
  assert.equal(result.stages.find((x) => x.timeframe === "30M")?.confirmed, false);
});

test("fails closed when 3m directional clue is unavailable", () => {
  const inputs = aligned.map((x) => ({ ...x }));
  inputs[0].direction = "FLAT";
  const result = buildH1TimeLagResponseLadder(inputs);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("3M_DIRECTIONAL_CLUE_UNAVAILABLE"));
});

test("fails closed when block timestamp skew exceeds policy", () => {
  const inputs = aligned.map((x) => ({ ...x }));
  inputs[3].blockEnd = "2026-09-04T09:15:00.000Z";
  const result = buildH1TimeLagResponseLadder(inputs);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("TEMPORAL_BLOCK_SKEW_TOO_LARGE"));
});

test("rejects upstream authority drift as missing safe input", () => {
  const inputs = aligned.map((x) => ({ ...x }));
  inputs[1].affectsExecution = true as false;
  const result = buildH1TimeLagResponseLadder(inputs);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MISSING_6M_STATE"));
});
