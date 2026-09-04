import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../h1-dynamic-readonly-server-bootstrap.ts", import.meta.url), "utf8");

test("H1 live readiness proof stays bounded to one 5s and one 3m timeout", () => {
  assert.match(source, /H1_DYNAMIC_READONLY_LIVE_PROOF/);
  assert.match(source, /5_000/);
  assert.match(source, /H1_DYNAMIC_READONLY_3M_LIVE_PROOF/);
  assert.match(source, /180_000/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("H1 bounded proof preserves test isolation and authority-free status", () => {
  assert.match(source, /process\.env\.NODE_ENV === "test"/);
  assert.match(source, /clearLiveProofTimers\(\)/);
  assert.match(source, /productionImpact: "NONE"/);
  assert.match(source, /affectsVerdict: false/);
  assert.match(source, /affectsExecution: false/);
  assert.match(source, /affectsTelegram: false/);
  assert.match(source, /forwardsDownstream: false/);
  assert.match(source, /failClosed: true/);
});
