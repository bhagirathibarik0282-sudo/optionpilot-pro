import {
  buildShadowStartupRecoveryRouteRegistration,
  type ShadowStartupRecoveryRouteRegistration,
} from "./shadow-startup-recovery-route-registration-adapter.js";
import type { ShadowStartupRecoveryReadonlyRouteRequest } from "./shadow-startup-recovery-readonly-route-handler.js";

export interface HonoLikeReadonlyApp {
  get(path: "/api/shadow/startup-recovery", handler: (context: unknown) => unknown): unknown;
}

export interface ShadowStartupRecoveryHonoBindingResult {
  version: "SHADOW_STARTUP_RECOVERY_HONO_BINDING_V1";
  accepted: boolean;
  bound: boolean;
  method: "GET";
  path: "/api/shadow/startup-recovery";
  reasonCodes: string[];
  readOnly: true;
  diagnosticOnly: true;
  bindingSideEffectsAllowed: false;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function blocked(reasonCode: string): ShadowStartupRecoveryHonoBindingResult {
  return {
    version: "SHADOW_STARTUP_RECOVERY_HONO_BINDING_V1",
    accepted: false,
    bound: false,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    reasonCodes: [reasonCode],
    readOnly: true,
    diagnosticOnly: true,
    bindingSideEffectsAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function bindShadowStartupRecoveryReadonlyRoute(
  app: HonoLikeReadonlyApp,
  registrationInput: Parameters<typeof buildShadowStartupRecoveryRouteRegistration>[0],
  requestFactory: (context: unknown) => ShadowStartupRecoveryReadonlyRouteRequest,
): ShadowStartupRecoveryHonoBindingResult {
  if (!app || typeof app.get !== "function") return blocked("INVALID_HONO_APP");
  if (typeof requestFactory !== "function") return blocked("INVALID_ROUTE_REQUEST_FACTORY");

  const built = buildShadowStartupRecoveryRouteRegistration(registrationInput);
  if (!built.accepted || !built.registration) return blocked(built.reasonCodes[0] ?? "ROUTE_REGISTRATION_REJECTED");

  const registration: ShadowStartupRecoveryRouteRegistration = built.registration;
  try {
    app.get(registration.path, (context: unknown) => {
      const request = requestFactory(context);
      return registration.handler(request);
    });
  } catch {
    return blocked("HONO_ROUTE_BINDING_FAILED");
  }

  return {
    version: "SHADOW_STARTUP_RECOVERY_HONO_BINDING_V1",
    accepted: true,
    bound: true,
    method: "GET",
    path: registration.path,
    reasonCodes: [],
    readOnly: true,
    diagnosticOnly: true,
    bindingSideEffectsAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
