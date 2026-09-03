import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLagTransitions, measureLagTransition } from "../lag-transition-research.js";

const base = "2026-09-03T03:45:00.000Z";
function at(min: number) { return new Date(Date.parse(base) + min * 60_000).toISOString(); }

test("canonical observed sequence passes and measures T0-relative lag", () => {
  const out = measureLagTransition({ tradeDate: "2026-09-03", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "DOWN" },
    { stage: "SECTOR", firstQualifiedAt: at(3), direction: "DOWN" },
    { stage: "BANKNIFTY", firstQualifiedAt: at(6), direction: "DOWN" },
    { stage: "NIFTY", firstQualifiedAt: at(9), direction: "DOWN" },
    { stage: "VIX", firstQualifiedAt: at(12), direction: "DOWN" },
    { stage: "PREMIUM", firstQualifiedAt: at(15), direction: "DOWN" },
    { stage: "WALL", firstQualifiedAt: at(18), direction: "DOWN" },
  ]});
  assert.equal(out.sequenceIntegrity, "PASS");
  assert.equal(out.directionalIntegrity, "ALIGNED");
  assert.equal(out.measurements.find((x) => x.stage === "WALL")?.lagFromT0Minutes, 18);
});

test("missing stages remain partial rather than invented", () => {
  const out = measureLagTransition({ tradeDate: "2026-09-03", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "UP" },
    { stage: "SECTOR", firstQualifiedAt: at(3), direction: "UP" },
    { stage: "NIFTY", firstQualifiedAt: at(9), direction: "UP" },
  ]});
  assert.equal(out.sequenceIntegrity, "PARTIAL");
  assert.ok(out.missingStages.includes("BANKNIFTY"));
  assert.ok(out.missingStages.includes("VIX"));
});

test("out of hypothesis order is divergent", () => {
  const out = measureLagTransition({ tradeDate: "2026-09-03", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "UP" },
    { stage: "NIFTY", firstQualifiedAt: at(3), direction: "UP" },
    { stage: "SECTOR", firstQualifiedAt: at(6), direction: "UP" },
  ]});
  assert.equal(out.sequenceIntegrity, "DIVERGENT");
});

test("multi-day aggregation computes reusable lag statistics", () => {
  const d1 = measureLagTransition({ tradeDate: "2026-09-01", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "UP" },
    { stage: "SECTOR", firstQualifiedAt: at(3), direction: "UP" },
  ]});
  const d2 = measureLagTransition({ tradeDate: "2026-09-02", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "UP" },
    { stage: "SECTOR", firstQualifiedAt: at(6), direction: "UP" },
  ]});
  const d3 = measureLagTransition({ tradeDate: "2026-09-03", events: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: at(0), direction: "UP" },
    { stage: "SECTOR", firstQualifiedAt: at(9), direction: "UP" },
  ]});
  const agg = aggregateLagTransitions([d1, d2, d3]);
  assert.equal(agg.sampleDays, 3);
  assert.equal(agg.usableDays, 3);
  assert.equal(agg.medianLagMinutesByStage.SECTOR, 6);
  assert.equal(agg.p75LagMinutesByStage.SECTOR, 7.5);
});

test("research engine has no live authority", () => {
  const out = measureLagTransition({ tradeDate: "2026-09-03", events: [] });
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_REPLAY_ONLY");
});
