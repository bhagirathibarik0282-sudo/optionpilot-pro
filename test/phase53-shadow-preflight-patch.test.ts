import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase50ScoreObservationPatch } from "../scripts/phase50-score-observation-patch-core.mjs";
import { applyPhase51ShadowReadinessPatch } from "../scripts/phase51-shadow-readiness-patch-core.mjs";
import { applyPhase53ShadowPreflightPatch } from "../scripts/phase53-shadow-preflight-patch-core.mjs";

function fetchCount(source: string) { return (source.match(/\bfetch\s*\(/g) || []).length; }

test("Phase 53 wires read-only preflight after verified Phase 51 runtime path", () => {
  const base = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p50 = applyPhase50ScoreObservationPatch(base).source;
  const p51 = applyPhase51ShadowReadinessPatch(p50).source;
  const beforeFetches = fetchCount(p51);
  const p53 = applyPhase53ShadowPreflightPatch(p51);
  assert.equal(p53.changed, true);
  assert.match(p53.source, /PHASE53_SHADOW_PREFLIGHT_WIRING_V1/);
  assert.match(p53.source, /\/api\/research\/shadow-preflight/);
  assert.match(p53.source, /getPhase53ShadowPreflight/);
  assert.equal(fetchCount(p53.source), beforeFetches, "Phase 53 must not add browser/broker fetch calls");
});

test("Phase 53 patch is idempotent", () => {
  const base = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p50 = applyPhase50ScoreObservationPatch(base).source;
  const p51 = applyPhase51ShadowReadinessPatch(p50).source;
  const once = applyPhase53ShadowPreflightPatch(p51);
  const twice = applyPhase53ShadowPreflightPatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("Phase 53 fails closed if Phase 51 anchor is absent", () => {
  assert.throws(() => applyPhase53ShadowPreflightPatch("const x=1;"), /Phase 51 import anchor expected exactly once/);
});
