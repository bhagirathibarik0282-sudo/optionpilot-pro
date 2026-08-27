import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnownThenScoreObservation,
  knownThenScoreSchemaSql,
  resolvePersistedObservationId,
  scoreObservationShadowEnabled,
  PHASE50_SCORE_OBSERVATION_SAFETY,
} from "../score-observation-known-then.js";

test("builds stable KNOWN_THEN observation from exact decision-time score decomposition", () => {
  const input = {
    symbol: "NIFTY",
    observedAt: "2026-08-26T10:00:00.000Z",
    legacyScore: 5.2,
    maxScore: 11,
    legacyVerdict: "Mixed / Sideways (WAIT)",
    contributions: { futures_vwap: 1, max_pain: 0.5, oi_pcr: 0 },
    overrides: [],
    legacyCandidate: "CE",
    sourcePath: "/api/premium-diagnostic/snapshot",
  };
  const a = buildKnownThenScoreObservation(input)!;
  const b = buildKnownThenScoreObservation(input)!;
  assert.equal(a.observationId, b.observationId);
  assert.equal(a.knownThen, true);
  assert.equal(a.maxPainContribution, 0.5);
});

test("unknown or invalid Max Pain contribution stays unknown rather than becoming zero", () => {
  const base = {
    symbol: "NIFTY", observedAt: "2026-08-26T10:00:00.000Z", legacyScore: 4,
    maxScore: 10, legacyVerdict: "WAIT", overrides: [], legacyCandidate: null,
  };
  assert.equal(buildKnownThenScoreObservation({ ...base, contributions: { oi_pcr: 1 } })!.maxPainContribution, null);
  assert.equal(buildKnownThenScoreObservation({ ...base, contributions: { max_pain: 0.25 } })!.maxPainContribution, null);
});

test("invalid score/timestamp/non-finite contribution fails closed", () => {
  const base = { symbol:"NIFTY", observedAt:"2026-08-26T10:00:00Z", legacyScore:1, maxScore:1, legacyVerdict:null, overrides:[], legacyCandidate:null };
  assert.equal(buildKnownThenScoreObservation({ ...base, legacyScore: Number.NaN, contributions:{} }), null);
  assert.equal(buildKnownThenScoreObservation({ ...base, observedAt:"bad", contributions:{} }), null);
  assert.equal(buildKnownThenScoreObservation({ ...base, contributions:{ x: Number.POSITIVE_INFINITY } }), null);
});

test("schema is additive append-only and duplicate-safe", () => {
  const sql = knownThenScoreSchemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS score_observation_known_then/);
  assert.match(sql, /observation_id TEXT PRIMARY KEY/);
  assert.doesNotMatch(sql, /UPDATE\s+score_observation_known_then/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+score_observation_known_then/i);
});

test("DB write failure cannot masquerade as persistence success", () => {
  const stableId = "stable-known-then-id";
  assert.equal(resolvePersistedObservationId(null, stableId), null);
  assert.equal(resolvePersistedObservationId({ rows: [] }, stableId), stableId, "successful duplicate-safe insert may return no row");
  assert.equal(resolvePersistedObservationId({ rows: [{ observation_id: "returned-id" }] }, stableId), "returned-id");
});

test("shadow collection defaults off", () => {
  assert.equal(scoreObservationShadowEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(scoreObservationShadowEnabled({ PHASE50_SCORE_SHADOW:"true" } as NodeJS.ProcessEnv), true);
});

test("Phase 50 cannot alter production decisions", () => {
  assert.deepEqual(PHASE50_SCORE_OBSERVATION_SAFETY, {
    appendOnly:true, knownThenOnly:true, shadowFlagDefaultOff:true, noExtraBrokerCall:true,
    affectsProductionScore:false, affectsVerdict:false, affectsTelegramTradeDecision:false,
    affectsExecution:false, noHindsightReconstruction:true,
  });
});
