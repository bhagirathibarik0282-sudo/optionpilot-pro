import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../research-router.ts", import.meta.url), "utf8");

test("exposes read-only H1 replay intelligence route without changing base replay route", () => {
  assert.match(src, /researchRouter\.get\("\/h1-replay-intelligence"/);
  assert.match(src, /runH1ReplayIntelligenceHttp/);
  assert.match(src, /READ_ONLY_H1_REPLAY_INTELLIGENCE_V1/);
  assert.match(src, /productionImpact:\s*"NONE"/);
  assert.match(src, /researchRouter\.get\("\/h1-replay"/);
});
