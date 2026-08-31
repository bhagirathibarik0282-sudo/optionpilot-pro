import { runShadowDurableStartupRecoveryRouteProvider } from "./shadow-durable-startup-recovery-route-provider.js";
import type { ShadowReplayPersistenceAdapterInput } from "./shadow-replay-persistence-adapter.js";
import { buildShadowStartupRecoveryDiagnosticReport } from "./shadow-startup-recovery-diagnostic-report.js";
import type { ShadowStartupRecoveryDiagnosticSnapshot } from "./shadow-startup-recovery-diagnostic-snapshot.js";
import {
  handleShadowStartupRecoveryReadonlyRoute,
  type ShadowStartupRecoveryReadonlyRouteResult,
} from "./shadow-startup-recovery-readonly-route-handler.js";

export interface DurableHonoLikeReadonlyApp {
  get(path: "/api/shadow/startup-recovery", handler: (context: unknown) => unknown): unknown;
}

export interface ShadowDurableStartupRecoveryContextFacts {
  executionId: string;
  persistence: ShadowReplayPersistenceAdapterInput;
  observedAt: string;
  startupFactsFresh: boolean;
  maxBrokerFactsAgeMs?: number;
}

export interface ShadowDurableStartupRecoveryHonoBindingResult {
  version: "SHADOW_DURABLE_STARTUP_RECOVERY_HONO_BINDING_V1";
  accepted: boolean;
  bound: boolean;
  method: "GET";
  path: "/api/shadow/startup-recovery";
  reasonCodes: string[];
  readOnly: true;
  diagnosticOnly: true;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function bindingBlocked(reasonCode: string): ShadowDurableStartupRecoveryHonoBindingResult {
  return {
    version: "SHADOW_DURABLE_STARTUP_RECOVERY_HONO_BINDING_V1",
    accepted: false,
    bound: false,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    reasonCodes: [reasonCode],
    readOnly: true,
    diagnosticOnly: true,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

function failClosedRoute(reasonCode: string): ShadowStartupRecoveryReadonlyRouteResult {
  const snapshot: ShadowStartupRecoveryDiagnosticSnapshot = {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1",
    observedAt: null,
    diagnosticAccepted: false,
    dryRunVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1",
    startupAccepted: false,
    decision: "HALT",
    runtimeAccepted: false,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    dryRunOnly: true,
    startupSideEffectsAllowed: false,
    diagnosticOnly: true,
    reasonCodes: [reasonCode],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
  const report = buildShadowStartupRecoveryDiagnosticReport(snapshot);
  return handleShadowStartupRecoveryReadonlyRoute({
    method: "GET",
    path: "/api/shadow/startup-recovery",
    report,
    readOnly: true,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  });
}

export function bindShadowDurableStartupRecoveryRoute(
  app: DurableHonoLikeReadonlyApp,
  factsFactory: (context: unknown) => ShadowDurableStartupRecoveryContextFacts | Promise<ShadowDurableStartupRecoveryContextFacts>,
): ShadowDurableStartupRecoveryHonoBindingResult {
  if (!app || typeof app.get !== "function") return bindingBlocked("INVALID_DURABLE_HONO_APP");
  if (typeof factsFactory !== "function") return bindingBlocked("INVALID_DURABLE_CONTEXT_FACTS_FACTORY");

  try {
    app.get("/api/shadow/startup-recovery", async (context: unknown) => {
      try {
        const facts = await factsFactory(context);
        if (!facts || typeof facts !== "object") return failClosedRoute("DURABLE_CONTEXT_FACTS_UNAVAILABLE");
        return await runShadowDurableStartupRecoveryRouteProvider({
          providerVersion: "SHADOW_DURABLE_STARTUP_RECOVERY_ROUTE_PROVIDER_V1",
          method: "GET",
          path: "/api/shadow/startup-recovery",
          executionId: facts.executionId,
          persistence: facts.persistence,
          observedAt: facts.observedAt,
          startupFactsFresh: facts.startupFactsFresh,
          maxBrokerFactsAgeMs: facts.maxBrokerFactsAgeMs,
          readOnly: true,
          authorizesOrder: false,
          brokerOrderAllowed: false,
          placesOrder: false,
          shadowOnly: true,
          failClosed: true,
        });
      } catch {
        return failClosedRoute("DURABLE_HONO_REQUEST_BUILD_FAILED");
      }
    });
  } catch {
    return bindingBlocked("DURABLE_HONO_ROUTE_BINDING_FAILED");
  }

  return {
    version: "SHADOW_DURABLE_STARTUP_RECOVERY_HONO_BINDING_V1",
    accepted: true,
    bound: true,
    method: "GET",
    path: "/api/shadow/startup-recovery",
    reasonCodes: [],
    readOnly: true,
    diagnosticOnly: true,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
