import {
  handleShadowStartupRecoveryReadonlyRoute,
  type ShadowStartupRecoveryReadonlyRouteRequest,
  type ShadowStartupRecoveryReadonlyRouteResult,
} from "./shadow-startup-recovery-readonly-route-handler.js";

export interface ShadowStartupRecoveryRouteRegistration {
  version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1";
  method: "GET";
  path: "/api/shadow/startup-recovery";
  handler: (request: ShadowStartupRecoveryReadonlyRouteRequest) => ShadowStartupRecoveryReadonlyRouteResult;
  readOnly: true;
  diagnosticOnly: true;
  registrationSideEffectsAllowed: false;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowStartupRecoveryRouteRegistrationResult {
  version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1";
  accepted: boolean;
  method: "GET";
  path: "/api/shadow/startup-recovery";
  registration: ShadowStartupRecoveryRouteRegistration | null;
  reasonCodes: string[];
  readOnly: true;
  diagnosticOnly: true;
  registrationSideEffectsAllowed: false;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function blocked(reasonCode: string): ShadowStartupRecoveryRouteRegistrationResult {
  return {
    version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1",
    accepted: false,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    registration: null,
    reasonCodes: [reasonCode],
    readOnly: true,
    diagnosticOnly: true,
    registrationSideEffectsAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function buildShadowStartupRecoveryRouteRegistration(input: {
  version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1";
  method: "GET";
  path: "/api/shadow/startup-recovery";
  readOnly: true;
  diagnosticOnly: true;
  registrationSideEffectsAllowed: false;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}): ShadowStartupRecoveryRouteRegistrationResult {
  if (!input || input.version !== "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1") {
    return blocked("INVALID_ROUTE_REGISTRATION_VERSION");
  }
  if (input.method !== "GET") return blocked("ROUTE_REGISTRATION_METHOD_NOT_ALLOWED");
  if (input.path !== "/api/shadow/startup-recovery") return blocked("ROUTE_REGISTRATION_PATH_MISMATCH");
  if (
    input.readOnly !== true ||
    input.diagnosticOnly !== true ||
    input.registrationSideEffectsAllowed !== false ||
    input.startupSideEffectsAllowed !== false ||
    input.newEntryResumeAllowed !== false ||
    input.authorizesOrder !== false ||
    input.brokerOrderAllowed !== false ||
    input.placesOrder !== false ||
    input.shadowOnly !== true ||
    input.failClosed !== true
  ) {
    return blocked("ROUTE_REGISTRATION_INVARIANT_VIOLATED");
  }

  const registration: ShadowStartupRecoveryRouteRegistration = {
    version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1",
    method: "GET",
    path: "/api/shadow/startup-recovery",
    handler: handleShadowStartupRecoveryReadonlyRoute,
    readOnly: true,
    diagnosticOnly: true,
    registrationSideEffectsAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };

  return {
    version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1",
    accepted: true,
    method: registration.method,
    path: registration.path,
    registration,
    reasonCodes: [],
    readOnly: true,
    diagnosticOnly: true,
    registrationSideEffectsAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
