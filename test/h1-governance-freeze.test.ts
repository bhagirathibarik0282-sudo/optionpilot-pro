import test from "node:test";
import assert from "node:assert/strict";
import { buildH1GovernanceSnapshot, H1_VERSION_REGISTRY } from "../h1-governance-freeze.js";

test("H1 governance keeps every new history layer research-only", () => {
  const g = buildH1GovernanceSnapshot();
  assert.equal(g.researchOnly, true);
  assert.equal(g.productionWeightingAllowed, false);
  assert.equal(g.probabilityClaimAllowed, false);
  assert.equal(g.liveVerdictAuthority, false);
  assert.equal(g.telegramAuthority, false);
  assert.equal(g.executionAuthority, false);
});

test("manual runtime hooks remain explicit blockers", () => {
  const g = buildH1GovernanceSnapshot();
  assert.equal(g.statusByArea.serverRuntimeHook, "PENDING_MANUAL_WIRING");
  assert.equal(g.statusByArea.derivedSchemaInitHook, "PENDING_MANUAL_WIRING");
  assert.ok(g.promotionBlockers.includes("MANUAL_SERVER_HOOK_NOT_WIRED"));
});

test("version registry is explicit and immutable by contract", () => {
  assert.equal(H1_VERSION_REGISTRY.schemaVersion, "H1_SCHEMA_V1");
  assert.equal(H1_VERSION_REGISTRY.oosVersion, "H1_OOS_CALIBRATION_V1");
});
