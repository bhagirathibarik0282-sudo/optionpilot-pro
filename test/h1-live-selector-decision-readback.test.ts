import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync(new URL("../research-server-hook.ts", import.meta.url), "utf8");

test("live selector decision readback is strictly read-only and authority-free", () => {
  assert.match(hook, /\/api\/research\/h1-live-selector-decisions/);
  assert.match(hook, /collectH1LiveSelectorDecisions\(nowIso\)/);
  assert.match(hook, /registrySize:\s*getH1LiveSelectorRegistrySize\(\)/);
  assert.match(hook, /version:\s*"H1_LIVE_SELECTOR_DECISION_READBACK_V1"/);
  assert.match(hook, /productionImpact:\s*"NONE"/);
  assert.match(hook, /forwardsDownstream:\s*false/);
  assert.match(hook, /affectsVerdict:\s*false/);
  assert.match(hook, /affectsTelegram:\s*false/);
  assert.match(hook, /affectsExecution:\s*false/);
  assert.match(hook, /failClosed:\s*true/);
});
