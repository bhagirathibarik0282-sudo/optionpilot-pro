import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase53ShadowPreflightPatch } from "../scripts/phase53-shadow-preflight-patch-core.mjs";
import { applyPhase54FailureInjectionPlaybookPatch } from "../scripts/phase54-failure-injection-playbook-patch-core.mjs";

function shadowFlagAssignmentCount(source: string): number {
  return (source.match(/PHASE50_SCORE_SHADOW\s*=(?!=)/g) || []).length;
}

function fetchCallCount(source: string): number {
  return (source.match(/\bfetch\s*\(/g) || []).length;
}

function destructiveSqlCount(source: string): number {
  return (source.match(/\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/gi) || []).length;
}

test("Phase 54 mounts a read-only playbook after Phase 53 wiring without adding live mutations", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p53 = applyPhase53ShadowPreflightPatch(source);
  const beforeFlagAssignments = shadowFlagAssignmentCount(p53.source);
  const beforeFetchCalls = fetchCallCount(p53.source);
  const beforeDestructiveSql = destructiveSqlCount(p53.source);

  const p54 = applyPhase54FailureInjectionPlaybookPatch(p53.source);
  assert.equal(p54.changed, true);
  assert.match(p54.source, /PHASE54_FAILURE_INJECTION_PLAYBOOK_WIRING_V1/);
  assert.match(p54.source, /\/api\/research\/failure-injection-playbook/);
  assert.match(p54.source, /buildPhase54PreparationReport/);

  assert.equal(
    shadowFlagAssignmentCount(p54.source),
    beforeFlagAssignments,
    "Phase 54 must not add any PHASE50_SCORE_SHADOW assignment",
  );
  assert.equal(fetchCallCount(p54.source), beforeFetchCalls, "Phase 54 must not add any fetch/broker call");
  assert.equal(destructiveSqlCount(p54.source), beforeDestructiveSql, "Phase 54 must not add destructive SQL");
});

test("Phase 54 patch is idempotent", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p53 = applyPhase53ShadowPreflightPatch(source);
  const once = applyPhase54FailureInjectionPlaybookPatch(p53.source);
  const twice = applyPhase54FailureInjectionPlaybookPatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("Phase 54 fails closed when Phase 53 anchor is absent", () => {
  assert.throws(
    () => applyPhase54FailureInjectionPlaybookPatch("const x = 1;"),
    /expected exactly once/,
  );
});
