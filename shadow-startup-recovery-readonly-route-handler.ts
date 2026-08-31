import {
  buildShadowStartupRecoveryObservabilityResponse,
  type ShadowStartupRecoveryObservabilityResponse,
} from "./shadow-startup-recovery-readonly-observability.js";
import type { ShadowStartupRecoveryDiagnosticReport } from "./shadow-startup-recovery-diagnostic-report.js";

export interface ShadowStartupRecoveryReadonlyRouteRequest {
  method: "GET";
  path: "/api/shadow/startup-recovery";
  report: ShadowStartupRecoveryDiagnosticReport;
  readOnly: true;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowStartupRecoveryReadonlyRouteResult extends ShadowStartupRecoveryObservabilityResponse {
  routeVersion: "SHADOW_STARTUP_RECOVERY_READONLY_ROUTE_V1";
  routeAccepted: boolean;
  method: "GET";
  path: "/api/shadow/startup-recovery";
  routeSideEffectsAllowed: false;
}

function blocked(reasonCode: string): ShadowStartupRecoveryReadonlyRouteResult {
  const payload = {
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1" as const,
    accepted: false,
    status: "BLOCK" as const,
    decision: "HALT" as const,
    reasonCodes: [reasonCode],
    readOnly: true as const,
    diagnosticOnly: true as const,
    loggingSideEffectAllowed: false as const,
    startupSideEffectsAllowed: false as const,
    newEntryResumeAllowed: false as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
  return {
    routeVersion: "SHADOW_STARTUP_RECOVERY_READONLY_ROUTE_V1",
    routeAccepted: false,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    routeSideEffectsAllowed: false,
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1",
    accepted: false,
    httpStatus: 503,
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
    body: JSON.stringify(payload),
    readOnly: true,
    diagnosticOnly: true,
    loggingSideEffectAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function handleShadowStartupRecoveryReadonlyRoute(
  request: ShadowStartupRecoveryReadonlyRouteRequest,
): ShadowStartupRecoveryReadonlyRouteResult {
  if (!request || request.method !== "GET") return blocked("READONLY_ROUTE_METHOD_NOT_ALLOWED");
  if (request.path !== "/api/shadow/startup-recovery") return blocked("READONLY_ROUTE_PATH_MISMATCH");
  if (!request.report) return blocked("READONLY_ROUTE_MISSING_REPORT");
  if (
    request.readOnly !== true ||
    request.authorizesOrder !== false ||
    request.brokerOrderAllowed !== false ||
    request.placesOrder !== false ||
    request.shadowOnly !== true ||
    request.failClosed !== true
  ) {
    return blocked("READONLY_ROUTE_INVARIANT_VIOLATED");
  }

  const response = buildShadowStartupRecoveryObservabilityResponse(request.report);
  return {
    ...response,
    routeVersion: "SHADOW_STARTUP_RECOVERY_READONLY_ROUTE_V1",
    routeAccepted: response.accepted,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    routeSideEffectsAllowed: false,
    readOnly: true,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
