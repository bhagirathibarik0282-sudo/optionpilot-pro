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


test("acceptance status exposes read-only meaningful Telegram preflight diagnostic", () => {
  assert.match(monitor, /getMeaningfulLivePreflightDiagnostic/);
  assert.match(monitor, /preflight:/);
  assert.match(monitor, /changesTelegramPayload:\s*false/);
  assert.match(monitor, /changesExecution:\s*false/);
});


test("preflight distinguishes selector BLOCK-only state from missing live window", () => {
  assert.match(monitor, /LIVE_SELECTOR_NO_SELECT_DECISION/);
  assert.match(monitor, /selectorSelectCount/);
  assert.match(monitor, /selectorBlockCount/);
  assert.match(monitor, /selectorReasonCodes/);
});


test("preflight selector counts are isolated to the requested symbol", () => {
  assert.match(monitor, /selector\.decisions\.filter\(\(decision\) => decision\.symbol === symbol\)/);
  assert.match(monitor, /symbolDecisions\.filter\(\(decision\) => decision\.decision === "SELECT"\)/);
  assert.match(monitor, /symbolDecisions\.filter\(\(decision\) => decision\.decision === "BLOCK"\)/);
});


test("preflight exposes per-contract selector decisions without changing authority", () => {
  assert.match(monitor, /selectorDecisions/);
  assert.match(monitor, /reasonCodes:\s*\[\.\.\.d\.reasonCodes\]/);
  assert.match(monitor, /changesTelegramPayload:\s*false/);
  assert.match(monitor, /changesExecution:\s*false/);
});
