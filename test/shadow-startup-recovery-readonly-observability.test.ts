import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowStartupRecoveryObservabilityResponse } from "../shadow-startup-recovery-readonly-observability.js";
import type { ShadowStartupRecoveryDiagnosticReport } from "../shadow-startup-recovery-diagnostic-report.js";

function report(status: "PASS" | "WARN" | "BLOCK" = "PASS"): ShadowStartupRecoveryDiagnosticReport {
  const payload = {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_REPORT_V1" as const,
    observedAt: "2026-08-31T05:40:00.000Z",
    status,
    decision: status === "BLOCK" ? "HALT" as const : status === "WARN" ? "RECONCILE_REQUIRED" as const : "RESUME_IDLE_SHADOW" as const,
    diagnosticAccepted: status !== "BLOCK",
    startupAccepted: status !== "BLOCK",
    runtimeAccepted: status !== "BLOCK",
    managementResumeAllowed: false,
    newEntryResumeAllowed: false as const,
    reconciliationRequired: status === "WARN",
    effectiveOpenQuantity: 0,
    reasonCodes: [],
    diagnosticOnly: true as const,
    loggingSideEffectAllowed: false as const,
    startupSideEffectsAllowed: false as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
  return { ...payload, deterministicJson: JSON.stringify(payload) };
}

test("PASS report becomes read-only 200 response", () => {
  const out = buildShadowStartupRecoveryObservabilityResponse(report("PASS"));
  assert.equal(out.accepted, true);
  assert.equal(out.httpStatus, 200);
  assert.equal(out.readOnly, true);
  assert.equal(out.placesOrder, false);
  assert.equal(out.startupSideEffectsAllowed, false);
});

test("WARN report remains read-only 200", () => {
  const out = buildShadowStartupRecoveryObservabilityResponse(report("WARN"));
  assert.equal(out.accepted, true);
  assert.equal(out.httpStatus, 200);
  assert.equal(JSON.parse(out.body).status, "WARN");
});

test("BLOCK report maps to 503 without enabling actions", () => {
  const out = buildShadowStartupRecoveryObservabilityResponse(report("BLOCK"));
  assert.equal(out.accepted, true);
  assert.equal(out.httpStatus, 503);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.newEntryResumeAllowed, false);
});

test("tampered order invariant fails closed", () => {
  const input: any = report();
  input.placesOrder = true;
  const out = buildShadowStartupRecoveryObservabilityResponse(input);
  assert.equal(out.accepted, false);
  assert.equal(out.httpStatus, 503);
  assert.equal(JSON.parse(out.body).reasonCodes[0], "OBSERVABILITY_INPUT_INVARIANT_VIOLATED");
});

test("invalid deterministic JSON fails closed", () => {
  const input = report();
  input.deterministicJson = "{bad-json";
  const out = buildShadowStartupRecoveryObservabilityResponse(input);
  assert.equal(out.accepted, false);
  assert.equal(out.httpStatus, 503);
  assert.equal(JSON.parse(out.body).reasonCodes[0], "INVALID_DIAGNOSTIC_REPORT_JSON");
});

test("outer status tamper against deterministic JSON fails closed", () => {
  const input: any = report("PASS");
  input.status = "BLOCK";
  const out = buildShadowStartupRecoveryObservabilityResponse(input);
  assert.equal(out.accepted, false);
  assert.equal(out.httpStatus, 503);
  assert.equal(JSON.parse(out.body).reasonCodes[0], "DIAGNOSTIC_REPORT_SEMANTIC_MISMATCH");
});

test("outer decision/reasonCodes tamper against deterministic JSON fails closed", () => {
  const input: any = report("WARN");
  input.decision = "RESUME_IDLE_SHADOW";
  input.reasonCodes = ["FABRICATED"];
  const out = buildShadowStartupRecoveryObservabilityResponse(input);
  assert.equal(out.accepted, false);
  assert.equal(out.httpStatus, 503);
  assert.equal(JSON.parse(out.body).reasonCodes[0], "DIAGNOSTIC_REPORT_SEMANTIC_MISMATCH");
});
