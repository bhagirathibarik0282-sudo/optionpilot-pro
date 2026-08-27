import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase51ShadowReadinessReport, PHASE51_SAFETY } from "../phase51-shadow-readiness.js";
import type { KnownThenScoreObservation } from "../score-observation-known-then.js";

function row(id: string, ts: string, symbol = "NIFTY", mp: -0.5 | 0 | 0.5 | null = 0.5): KnownThenScoreObservation {
  return {
    observationId: id, symbol, observedAt: ts, legacyScore: 2, maxScore: 10,
    legacyVerdict: "WAIT", contributions: mp == null ? { oi_pcr: 1 } : { max_pain: mp },
    overrides: [], legacyCandidate: null, sourcePath: "/api/premium-diagnostic/snapshot",
    knownThen: true, maxPainContribution: mp, version: "KNOWN_THEN_SCORE_OBSERVATION_V1",
  };
}

test("shadow readiness remains disabled when flag is off even if rows exist", () => {
  const report = buildPhase51ShadowReadinessReport([row("a", "2026-08-26T09:15:00Z")], false);
  assert.equal(report.collectionState, "DISABLED");
  assert.equal(report.totalRows, 1);
  assert.equal(report.automaticActivationAllowed, false);
  assert.equal(report.productionReady, false);
});

test("enabled with no rows is explicit NO_DATA rather than healthy", () => {
  const report = buildPhase51ShadowReadinessReport([], true);
  assert.equal(report.collectionState, "ENABLED_NO_DATA");
  assert.equal(report.maxPainContributionKnownRate, null);
  assert.equal(report.cadence.medianSeconds, null);
});

test("observability reports counts, unknown Max Pain and descriptive cadence without threshold", () => {
  const rows = [
    row("a", "2026-08-26T09:15:00Z", "NIFTY", 0.5),
    row("b", "2026-08-26T09:18:00Z", "NIFTY", null),
    row("c", "2026-08-26T09:24:00Z", "BANKNIFTY", -0.5),
  ];
  const r = buildPhase51ShadowReadinessReport(rows, true);
  assert.equal(r.collectionState, "ENABLED_OBSERVING");
  assert.deepEqual(r.symbolCounts, { NIFTY: 2, BANKNIFTY: 1 });
  assert.equal(r.maxPainContributionKnownRows, 2);
  assert.equal(r.maxPainContributionUnknownRows, 1);
  assert.equal(r.maxPainContributionKnownRate, 2 / 3);
  assert.equal(r.cadence.minSeconds, 180);
  assert.equal(r.cadence.medianSeconds, 270);
  assert.equal(r.cadence.maxSeconds, 360);
});

test("duplicate IDs are surfaced, not silently treated as independent evidence", () => {
  const r = buildPhase51ShadowReadinessReport([
    row("same", "2026-08-26T09:15:00Z"), row("same", "2026-08-26T09:18:00Z")
  ], true);
  assert.equal(r.distinctObservationIds, 1);
  assert.equal(r.duplicateObservationIds, 1);
});

test("Phase 51 safety forbids automatic activation and production effects", () => {
  assert.deepEqual(PHASE51_SAFETY, {
    readOnlyObservability: true, shadowFlagMutation: false, automaticActivationAllowed: false,
    productionReady: false, affectsProductionScore: false, affectsVerdict: false,
    affectsTelegramTradeDecision: false, affectsExecution: false, addsBrokerRequest: false,
    freezesCadenceThreshold: false,
  });
});
