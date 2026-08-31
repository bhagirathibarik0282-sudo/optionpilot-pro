import test from "node:test";
import assert from "node:assert/strict";
import { handleShadowStartupRecoveryReadonlyRoute } from "../shadow-startup-recovery-readonly-route-handler.js";
import type { ShadowStartupRecoveryDiagnosticReport } from "../shadow-startup-recovery-diagnostic-report.js";

function report(status: "PASS" | "WARN" | "BLOCK" = "PASS"): ShadowStartupRecoveryDiagnosticReport {
  const payload = {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_REPORT_V1" as const,
    observedAt: "2026-08-31T05:45:00.000Z",
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

function request(r = report()) {
  return {
    method: "GET" as const,
    path: "/api/shadow/startup-recovery" as const,
    report: r,
    readOnly: true as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

test("GET route returns read-only PASS response with zero side effects", () => {
  const result = handleShadowStartupRecoveryReadonlyRoute(request());
  assert.equal(result.routeAccepted, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.routeSideEffectsAllowed, false);
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.placesOrder, false);
});

test("BLOCK report remains 503 and never authorizes execution", () => {
  const result = handleShadowStartupRecoveryReadonlyRoute(request(report("BLOCK")));
  assert.equal(result.httpStatus, 503);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.brokerOrderAllowed, false);
});

test("non-GET method fails closed", () => {
  const input: any = request();
  input.method = "POST";
  const result = handleShadowStartupRecoveryReadonlyRoute(input);
  assert.equal(result.routeAccepted, false);
  assert.equal(result.httpStatus, 503);
});

test("wrong path fails closed", () => {
  const input: any = request();
  input.path = "/api/live/order";
  const result = handleShadowStartupRecoveryReadonlyRoute(input);
  assert.equal(result.routeAccepted, false);
  assert.match(result.body, /READONLY_ROUTE_PATH_MISMATCH/);
});

test("route invariant tampering fails closed", () => {
  const input: any = request();
  input.placesOrder = true;
  const result = handleShadowStartupRecoveryReadonlyRoute(input);
  assert.equal(result.routeAccepted, false);
  assert.equal(result.placesOrder, false);
  assert.equal(result.routeSideEffectsAllowed, false);
});
