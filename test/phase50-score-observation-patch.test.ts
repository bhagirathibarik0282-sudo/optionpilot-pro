import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase50ScoreObservationPatch } from "../scripts/phase50-score-observation-patch-core.mjs";

function fetchCallCount(source: string): number {
  return (source.match(/\bfetch\s*\(/g) || []).length;
}

test("Phase 50 patch reuses existing diagnostic POST with no extra broker request", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const beforeFetches = fetchCallCount(source);
  const r = applyPhase50ScoreObservationPatch(source);
  assert.equal(r.changed, true);
  assert.match(r.source, /PHASE50_KNOWN_THEN_SCORE_WIRING_V1/);
  assert.match(r.source, /persistKnownThenScoreObservation/);
  assert.match(r.source, /ruleContributions: result\.contributions \|\| \{\}/);
  assert.match(r.source, /\/api\/research\/max-pain-counterfactual/);
  assert.match(r.source, /\/api\/premium-diagnostic\/snapshot/);
  assert.equal(fetchCallCount(r.source), beforeFetches, "Phase 50 must not add any fetch call");
});

test("Phase 50 patch is idempotent", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const once = applyPhase50ScoreObservationPatch(source);
  const twice = applyPhase50ScoreObservationPatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("Phase 50 patch fails closed if exact source anchors drift", () => {
  assert.throws(() => applyPhase50ScoreObservationPatch("const x = 1;"), /anchor missing/);
});
