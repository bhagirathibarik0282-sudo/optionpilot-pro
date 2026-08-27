import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase50ScoreObservationPatch } from "../scripts/phase50-score-observation-patch-core.mjs";

test("Phase 50 live server wiring is present and remains idempotent", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(source, /PHASE50_KNOWN_THEN_SCORE_WIRING_V1/);
  assert.match(source, /persistKnownThenScoreObservation/);
  assert.match(source, /ruleContributions: result\.contributions \|\| \{\}/);
  assert.match(source, /sourcePath: "\/api\/premium-diagnostic\/snapshot"/);
  const r = applyPhase50ScoreObservationPatch(source);
  assert.equal(r.changed, false);
  assert.equal(r.source, source);
});

test("Phase 50 live wiring remains shadow-only at persistence boundary", () => {
  const source = readFileSync(new URL("../score-observation-known-then.ts", import.meta.url), "utf8");
  assert.match(source, /PHASE50_SCORE_SHADOW/);
  assert.match(source, /if \(!scoreObservationShadowEnabled\(\)\) return null;/);
  assert.match(source, /ON CONFLICT \(observation_id\) DO NOTHING/);
  assert.match(source, /affectsProductionScore: false/);
  assert.match(source, /affectsVerdict: false/);
  assert.match(source, /affectsTelegramTradeDecision: false/);
  assert.match(source, /affectsExecution: false/);
});

test("Phase 50 patch fails closed if exact source anchors drift", () => {
  assert.throws(() => applyPhase50ScoreObservationPatch("const x = 1;"), /expected exactly once/);
});
