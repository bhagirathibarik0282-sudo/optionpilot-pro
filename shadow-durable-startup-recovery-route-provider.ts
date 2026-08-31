import {
  runShadowDurableBrokerRestartProvider,
  type ShadowDurableBrokerRestartProviderInput,
} from "./shadow-durable-broker-restart-provider.js";
import type { ShadowPostgresRestartRuntimeResult } from "./shadow-postgres-restart-runtime-adapter.js";
import type { ShadowReplayPersistenceAdapterInput } from "./shadow-replay-persistence-adapter.js";
import { buildShadowStartupRecoveryDiagnosticReport } from "./shadow-startup-recovery-diagnostic-report.js";
import type { ShadowStartupRecoveryDiagnosticSnapshot } from "./shadow-startup-recovery-diagnostic-snapshot.js";
import {
  handleShadowStartupRecoveryReadonlyRoute,
  type ShadowStartupRecoveryReadonlyRouteResult,
} from "./shadow-startup-recovery-readonly-route-handler.js";

export interface ShadowDurableStartupRecoveryRouteProviderInput {
  providerVersion: "SHADOW_DURABLE_STARTUP_RECOVERY_ROUTE_PROVIDER_V1";
  method: "GET";
  path: "/api/shadow/startup-recovery";
  executionId: string;
  persistence: ShadowReplayPersistenceAdapterInput;
  observedAt: string;
  startupFactsFresh: boolean;
  maxBrokerFactsAgeMs?: number;
  readOnly: true;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowDurableStartupRecoveryRouteProviderDeps {
  runProvider?: (
    input: ShadowDurableBrokerRestartProviderInput,
  ) => Promise<ShadowPostgresRestartRuntimeResult>;
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function blockedReport(reasonCode: string, observedAt: string | null): ShadowStartupRecoveryDiagnosticSnapshot {
  return {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1",
    observedAt,
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
}

function toSnapshot(
  runtime: ShadowPostgresRestartRuntimeResult,
  observedAt: string,
): ShadowStartupRecoveryDiagnosticSnapshot {
  return {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1",
    observedAt,
    diagnosticAccepted: true,
    dryRunVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1",
    startupAccepted: true,
    decision: runtime.decision,
    runtimeAccepted: runtime.runtimeAccepted,
    managementResumeAllowed: runtime.managementResumeAllowed,
    newEntryResumeAllowed: false,
    reconciliationRequired: runtime.reconciliationRequired,
    effectiveOpenQuantity: runtime.effectiveOpenQuantity,
    dryRunOnly: true,
    startupSideEffectsAllowed: false,
    diagnosticOnly: true,
    reasonCodes: [...runtime.reasonCodes],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

function routeFromSnapshot(snapshot: ShadowStartupRecoveryDiagnosticSnapshot): ShadowStartupRecoveryReadonlyRouteResult {
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

export async function runShadowDurableStartupRecoveryRouteProvider(
  input: ShadowDurableStartupRecoveryRouteProviderInput,
  deps: ShadowDurableStartupRecoveryRouteProviderDeps = {},
): Promise<ShadowStartupRecoveryReadonlyRouteResult> {
  const observedAt = validIso(input?.observedAt) ? input.observedAt : null;
  if (!input || input.providerVersion !== "SHADOW_DURABLE_STARTUP_RECOVERY_ROUTE_PROVIDER_V1") {
    return routeFromSnapshot(blockedReport("INVALID_DURABLE_STARTUP_ROUTE_PROVIDER_VERSION", observedAt));
  }
  if (input.method !== "GET" || input.path !== "/api/shadow/startup-recovery") {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_METHOD_OR_PATH_INVALID", observedAt));
  }
  if (!validIso(input.observedAt)) {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_OBSERVED_AT_INVALID", null));
  }
  if (typeof input.executionId !== "string" || !input.executionId.trim()) {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_EXECUTION_ID_INVALID", input.observedAt));
  }
  if (!input.persistence) {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_PERSISTENCE_MISSING", input.observedAt));
  }
  if (input.startupFactsFresh !== true) {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_STARTUP_FACTS_STALE", input.observedAt));
  }
  if (
    input.readOnly !== true ||
    input.authorizesOrder !== false ||
    input.brokerOrderAllowed !== false ||
    input.placesOrder !== false ||
    input.shadowOnly !== true ||
    input.failClosed !== true
  ) {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_INVARIANT_VIOLATED", input.observedAt));
  }

  const runProvider = deps.runProvider ?? runShadowDurableBrokerRestartProvider;
  if (typeof runProvider !== "function") {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_PROVIDER_DEPENDENCY_INVALID", input.observedAt));
  }

  try {
    const runtime = await runProvider({
      providerVersion: "SHADOW_DURABLE_BROKER_RESTART_PROVIDER_V1",
      executionId: input.executionId.trim(),
      persistence: input.persistence,
      nowIso: input.observedAt,
      maxBrokerFactsAgeMs: input.maxBrokerFactsAgeMs,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    });
    if (
      !runtime ||
      runtime.authorizesOrder !== false ||
      runtime.brokerOrderAllowed !== false ||
      runtime.placesOrder !== false ||
      runtime.shadowOnly !== true ||
      runtime.failClosed !== true ||
      runtime.newEntryResumeAllowed !== false
    ) {
      return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_RUNTIME_INVARIANT_VIOLATED", input.observedAt));
    }
    return routeFromSnapshot(toSnapshot(runtime, input.observedAt));
  } catch {
    return routeFromSnapshot(blockedReport("DURABLE_STARTUP_ROUTE_PROVIDER_FAILED", input.observedAt));
  }
}
