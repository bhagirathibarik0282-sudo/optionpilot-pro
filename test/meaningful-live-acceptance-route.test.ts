import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const router = readFileSync(new URL("../research-router.ts", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../meaningful-live-acceptance-monitor.ts", import.meta.url), "utf8");

test("meaningful live acceptance status is exposed read-only under research router", () => {
  assert.match(router, /researchRouter\.get\("\/meaningful-live-acceptance"/);
  assert.match(router, /getMeaningfulLiveAcceptanceStatus/);
  assert.match(router, /productionImpact:\s*"NONE"/);
  assert.doesNotMatch(router, /researchRouter\.post\("\/meaningful-live-acceptance"/);
});

test("acceptance monitor cannot change Telegram payload, verdict, execution, or orders", () => {
  assert.match(monitor, /readOnlyEndpoint:\s*true/);
  assert.match(monitor, /changesTelegramPayload:\s*false/);
  assert.match(monitor, /changesVerdict:\s*false/);
  assert.match(monitor, /changesExecution:\s*false/);
  assert.match(monitor, /createsOrders:\s*false/);
});
