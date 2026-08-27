import test from "node:test";
import assert from "node:assert/strict";
import { applyPhase58ServerShadowPersistencePatch } from "../scripts/phase58-server-shadow-persistence-core.mjs";

const signature = "function runRuleEngineServer(symbol: string, m: IndexMetrics | undefined, validation: ServerValidationResult, sectorBreadth: number | null): ServerRuleEngineResult {";

function fixture() {
  return `import { persistKnownThenScoreObservation } from \"./score-observation-known-then.js\";\n${signature}\n  return { score: 1 } as any;\n}\n`;
}

test("Phase58 renames original server rule engine and adds observer wrapper", () => {
  const result = applyPhase58ServerShadowPersistencePatch(fixture());
  assert.equal(result.changed, true);
  assert.match(result.source, /function runRuleEngineServerCore\(/);
  assert.match(result.source, /PHASE58_SERVER_SHADOW_SCORE_PERSISTENCE_V1/);
  assert.match(result.source, /persistKnownThenScoreObservation\(\{/);
  assert.match(result.source, /sourcePath: \"server:runRuleEngineServer\"/);
});

test("Phase58 is idempotent", () => {
  const once = applyPhase58ServerShadowPersistencePatch(fixture());
  const twice = applyPhase58ServerShadowPersistencePatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("Phase58 fails closed when source signature drifts", () => {
  assert.throws(() => applyPhase58ServerShadowPersistencePatch("function somethingElse() {}"), /expected exactly once/);
});

test("Phase58 wrapper preserves deterministic result and uses stable market snapshot time", () => {
  const result = applyPhase58ServerShadowPersistencePatch(fixture()).source;
  assert.match(result, /const result = runRuleEngineServerCore\(symbol, m, validation, sectorBreadth\);/);
  assert.match(result, /m\?\.timestamp/);
  assert.match(result, /shadow\.verdict !== \"DATA UNAVAILABLE\"/);
  assert.match(result, /return result;/);
  assert.doesNotMatch(result, /fetch\(/);
});
