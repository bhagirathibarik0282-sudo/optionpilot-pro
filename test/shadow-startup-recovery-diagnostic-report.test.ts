import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowStartupRecoveryDiagnosticReport } from "../shadow-startup-recovery-diagnostic-report.js";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1" as const,
    observedAt: "2026-08-31T05:40:00.000Z",
    diagnosticAccepted: true,
    dryRunVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1" as const,
    startupAccepted: true,
    decision: "RESUME_IDLE_SHADOW" as const,
    runtimeAccepted: true,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false as const,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    dryRunOnly: true as const,
    startupSideEffectsAllowed: false as const,
    diagnosticOnly: true as const,
    reasonCodes: [],
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
    ...overrides,
  } as any;
}

test("stable safe snapshot produces PASS deterministic report", () => {
  const a = buildShadowStartupRecoveryDiagnosticReport(snapshot());
  const b = buildShadowStartupRecoveryDiagnosticReport(snapshot());
  assert.equal(a.status, "PASS");
  assert.equal(a.deterministicJson, b.deterministicJson);
  assert.equal(a.loggingSideEffectAllowed, false);
  assert.equal(a.startupSideEffectsAllowed, false);
  assert.equal(a.newEntryResumeAllowed, false);
  assert.equal(a.placesOrder, false);
});

test("reconcile maps to WARN without granting entry authority", () => {
  const r = buildShadowStartupRecoveryDiagnosticReport(snapshot({ decision: "RECONCILE_REQUIRED", reconciliationRequired: true }));
  assert.equal(r.status, "WARN");
  assert.equal(r.newEntryResumeAllowed, false);
  assert.equal(r.authorizesOrder, false);
});

test("halt maps to BLOCK", () => {
  const r = buildShadowStartupRecoveryDiagnosticReport(snapshot({ decision: "HALT", diagnosticAccepted: false, reasonCodes: ["X"] }));
  assert.equal(r.status, "BLOCK");
  assert.deepEqual(r.reasonCodes, ["X"]);
});

test("order invariant tampering fails closed", () => {
  const r = buildShadowStartupRecoveryDiagnosticReport(snapshot({ placesOrder: true }));
  assert.equal(r.status, "BLOCK");
  assert.equal(r.decision, "HALT");
  assert.deepEqual(r.reasonCodes, ["DIAGNOSTIC_REPORT_INPUT_INVARIANT_VIOLATED"]);
  assert.equal(r.placesOrder, false);
});

test("startup or new-entry side-effect tampering fails closed", () => {
  const r = buildShadowStartupRecoveryDiagnosticReport(snapshot({ startupSideEffectsAllowed: true, newEntryResumeAllowed: true }));
  assert.equal(r.status, "BLOCK");
  assert.equal(r.startupSideEffectsAllowed, false);
  assert.equal(r.newEntryResumeAllowed, false);
});
