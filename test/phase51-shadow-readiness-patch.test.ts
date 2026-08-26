import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase50ScoreObservationPatch } from "../scripts/phase50-score-observation-patch-core.mjs";
import { applyPhase51ShadowReadinessPatch } from "../scripts/phase51-shadow-readiness-patch-core.mjs";

function fetchCallCount(source: string): number {
  return (source.match(/\bfetch\s*\(/g) || []).length;
}

test("Phase 51 wires a read-only readiness route after Phase 50 without extra fetch", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p50 = applyPhase50ScoreObservationPatch(source).source;
  const beforeFetches = fetchCallCount(p50);
  const r = applyPhase51ShadowReadinessPatch(p50);
  assert.equal(r.changed, true);
  assert.match(r.source, /PHASE51_SHADOW_READINESS_WIRING_V1/);
  assert.match(r.source, /\/api\/research\/shadow-readiness/);
  assert.match(r.source, /getPhase51ShadowReadiness/);
  assert.equal(fetchCallCount(r.source), beforeFetches);
});

test("Phase 51 patch is idempotent", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p50 = applyPhase50ScoreObservationPatch(source).source;
  const once = applyPhase51ShadowReadinessPatch(p50);
  const twice = applyPhase51ShadowReadinessPatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("Phase 51 fails closed when Phase 50 wiring is absent", () => {
  assert.throws(() => applyPhase51ShadowReadinessPatch("const x = 1;"), /Phase 50 import anchor expected exactly once/);
});
