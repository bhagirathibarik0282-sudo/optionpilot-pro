import test from "node:test";
import assert from "node:assert/strict";
import { buildH1CrossIndexBreadthState } from "../h1-cross-index-breadth-state.js";
import type { TemporalEvidenceSnapshot } from "../temporal-evidence-fusion.js";

function row(symbol: "NIFTY" | "BANKNIFTY" | "SENSEX", direction: TemporalEvidenceSnapshot["direction"], state: TemporalEvidenceSnapshot["state"]): TemporalEvidenceSnapshot {
  return {
    symbol,
    timeframe: "15M",
    blockEnd: "2026-09-04T09:30:00.000Z",
    previousBlockEnd: "2026-09-04T09:15:00.000Z",
    state,
    direction,
    currentReturnPct: direction === "UP" ? 0.12 : direction === "DOWN" ? -0.12 : 0,
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

test("classifies observational breadth while constituent detail remains unavailable", () => {
  const result = buildH1CrossIndexBreadthState([
    row("NIFTY", "UP", "STRENGTHENING"),
    row("BANKNIFTY", "UP", "STABLE"),
    row("SENSEX", "UP", "WEAKENING"),
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.consensusDirection, "UP");
  assert.equal(result.rows.find((x) => x.symbol === "NIFTY")?.state, "LEADING");
  assert.equal(result.rows.find((x) => x.symbol === "BANKNIFTY")?.state, "CONFIRMING");
  assert.equal(result.rows.find((x) => x.symbol === "SENSEX")?.state, "FADING");
  assert.equal(result.heavyweightDetailAvailable, false);
  assert.equal(result.sectorDetailAvailable, false);
  assert.equal(result.heavyweightDetailStatus, "UNAVAILABLE");
  assert.equal(result.sectorDetailStatus, "UNAVAILABLE");
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("marks flat index as lagging when two-index consensus exists", () => {
  const result = buildH1CrossIndexBreadthState([
    row("NIFTY", "DOWN", "STRENGTHENING"),
    row("BANKNIFTY", "DOWN", "STABLE"),
    row("SENSEX", "FLAT", "STABLE"),
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.consensusDirection, "DOWN");
  assert.equal(result.rows.find((x) => x.symbol === "SENSEX")?.state, "LAGGING");
});

test("fails closed when directions do not form a majority", () => {
  const result = buildH1CrossIndexBreadthState([
    row("NIFTY", "UP", "STABLE"),
    row("BANKNIFTY", "DOWN", "STABLE"),
    row("SENSEX", "FLAT", "STABLE"),
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.consensusDirection, null);
  assert.ok(result.blockers.includes("CROSS_INDEX_DIRECTION_CONSENSUS_UNAVAILABLE"));
});

test("fails closed on duplicate or missing index input", () => {
  const result = buildH1CrossIndexBreadthState([
    row("NIFTY", "UP", "STABLE"),
    row("NIFTY", "UP", "STRENGTHENING"),
    row("SENSEX", "UP", "STABLE"),
  ]);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("DUPLICATE_INDEX_INPUT:NIFTY"));
  assert.ok(result.blockers.includes("MISSING_15M_INDEX_STATE:BANKNIFTY"));
});

test("rejects upstream authority drift", () => {
  const unsafe = row("NIFTY", "UP", "STABLE");
  unsafe.affectsTelegram = true as false;
  const result = buildH1CrossIndexBreadthState([
    unsafe,
    row("BANKNIFTY", "UP", "STABLE"),
    row("SENSEX", "UP", "STABLE"),
  ]);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MISSING_15M_INDEX_STATE:NIFTY"));
});
