import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase53ShadowPreflightPatch } from "../scripts/phase53-shadow-preflight-patch-core.mjs";
import { applyPhase54FailureInjectionPlaybookPatch } from "../scripts/phase54-failure-injection-playbook-patch-core.mjs";

test("Phase 54 mounts read-only playbook after Phase 53 wiring", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const p53 = applyPhase53ShadowPreflightPatch(source);
  const p54 = applyPhase54FailureInjectionPlaybookPatch(p53.source);
  assert.equal(p54.changed, true);
  assert.match(p54.source, /PHASE54_FAILURE_INJECTION_PLAYBOOK_WIRING_V1/);
  assert.match(p54.source, /\/api\/research\/failure-injection-playbook/);
  assert.doesNotMatch(p54.source, /PHASE50_SCORE_SHADOW\s*=/);
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
  assert.throws(() => applyPhase54FailureInjectionPlaybookPatch("const x = 1;"), /Phase 53 import anchor/);
});
