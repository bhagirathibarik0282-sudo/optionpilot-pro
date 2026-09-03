import assert from "node:assert/strict";
import test from "node:test";
import { auditH1LivePublisherReadiness } from "../h1-live-publisher-readiness-audit.js";

test("publisher readiness stays fail-closed until every gate is exact live deterministic", () => {
  const result = auditH1LivePublisherReadiness();
  assert.equal(result.publisherReady, false);
  assert.equal(result.failClosed, true);
  assert.ok(result.blockers.length > 0);
  assert.equal(result.gates.every((gate) => gate.publishAllowed === false), true);
});

test("research shadow sources are never publishable", () => {
  const result = auditH1LivePublisherReadiness();
  const shadow = result.gates.filter((gate) => gate.sourceClass === "RESEARCH_SHADOW_ONLY");
  assert.deepEqual(
    shadow.map((gate) => gate.gate).sort(),
    ["deltaGammaResponseConfirmed", "multiExpiryConflictAbsent", "premiumResponseConfirmed", "thetaIvBurdenAcceptable"].sort(),
  );
  assert.equal(shadow.every((gate) => gate.publishAllowed === false), true);
});

test("combined liquidity-spread and nearest-DTE sources remain partial until exact mappings are frozen", () => {
  const result = auditH1LivePublisherReadiness();
  for (const name of ["liquidityOk", "spreadOk", "currentOrNearExpiryUsable"] as const) {
    const gate = result.gates.find((item) => item.gate === name);
    assert.ok(gate);
    assert.equal(gate.sourceClass, "LIVE_DETERMINISTIC_PARTIAL");
    assert.equal(gate.publishAllowed, false);
  }
});

test("capital and unsupported DTE approvals remain unavailable rather than inferred", () => {
  const result = auditH1LivePublisherReadiness();
  for (const name of ["capitalFit", "higherDteUsable", "fallbackDteApproved"] as const) {
    const gate = result.gates.find((item) => item.gate === name);
    assert.ok(gate);
    assert.equal(gate.sourceClass, "UNVERIFIED_OR_MISSING");
    assert.equal(gate.publishAllowed, false);
  }
});

test("audit has no execution, Telegram, verdict, order, or AI authority", () => {
  const result = auditH1LivePublisherReadiness();
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
  assert.equal(result.aiMayOverride, false);
});
