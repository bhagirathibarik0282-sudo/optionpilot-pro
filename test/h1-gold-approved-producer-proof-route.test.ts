import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../research-server-hook.ts", import.meta.url), "utf8");

test("approved producer proof route is read-only and exposes exact blockers", () => {
  assert.match(hook, /\/api\/research\/h1-gold-approved-producer-proof/);
  assert.match(hook, /loadLatestH1GoldChaseApprovedProducerProof\(\)/);
  assert.match(hook, /NO_PERSISTED_APPROVED_PRODUCER_PROOF/);
  assert.match(hook, /liveProofOnly:\s*true/);
  assert.match(hook, /acceptsReplay:\s*false/);
  assert.match(hook, /acceptsSynthetic:\s*false/);
  assert.match(hook, /affectsGoldEligibility:\s*false/);
  assert.match(hook, /affectsSelector:\s*false/);
  assert.match(hook, /affectsTelegram:\s*false/);
  assert.match(hook, /affectsExecution:\s*false/);
  assert.match(hook, /createsOrders:\s*false/);
  assert.match(hook, /failClosed:\s*true/);
});
