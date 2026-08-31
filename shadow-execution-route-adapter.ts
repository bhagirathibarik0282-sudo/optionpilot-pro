export type ShadowExecutionRoute =
  | "BLOCKED"
  | "SHADOW_ENTRY_PIPELINE"
  | "RECONCILIATION_PIPELINE"
  | "MANAGEMENT_ONLY"
  | "NO_NEW_ACTION"
  | "EMERGENCY_EXIT_PIPELINE";

export interface ShadowExecutionRouteAdapterInput {
  coordinatorVersion: "SHADOW_EXECUTION_INTENT_COORDINATOR_V1";
  route: ShadowExecutionRoute;
  downstreamEntryEligible: boolean;
  downstreamManagementEligible: boolean;
  downstreamEmergencyExitEligible: boolean;
  downstreamReconciliationRequired: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
  exactContractBound: boolean;
}

export interface ShadowExecutionRouteAdapterResult {
  version: "SHADOW_EXECUTION_ROUTE_ADAPTER_V1";
  adapterDecision: "BLOCK" | "ENTRY_STATE_READY" | "RECONCILIATION_READY" | "MANAGEMENT_READY" | "NO_ACTION" | "EMERGENCY_EXIT_READY";
  entryAuthorizationDecision: "AUTHORIZE_SIMULATION" | "BLOCK";
  reconciliationRequested: boolean;
  managementRequested: boolean;
  emergencyExitRequested: boolean;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function out(
  adapterDecision: ShadowExecutionRouteAdapterResult["adapterDecision"],
  reasonCodes: string[],
  flags: Partial<Pick<ShadowExecutionRouteAdapterResult,
    "entryAuthorizationDecision" | "reconciliationRequested" | "managementRequested" | "emergencyExitRequested">> = {},
): ShadowExecutionRouteAdapterResult {
  return {
    version: "SHADOW_EXECUTION_ROUTE_ADAPTER_V1",
    adapterDecision,
    entryAuthorizationDecision: flags.entryAuthorizationDecision ?? "BLOCK",
    reconciliationRequested: flags.reconciliationRequested ?? false,
    managementRequested: flags.managementRequested ?? false,
    emergencyExitRequested: flags.emergencyExitRequested ?? false,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function adaptShadowExecutionRoute(input: ShadowExecutionRouteAdapterInput): ShadowExecutionRouteAdapterResult {
  const reasons: string[] = [];
  if (input?.coordinatorVersion !== "SHADOW_EXECUTION_INTENT_COORDINATOR_V1") reasons.push("INVALID_COORDINATOR_VERSION");
  if (!["BLOCKED","SHADOW_ENTRY_PIPELINE","RECONCILIATION_PIPELINE","MANAGEMENT_ONLY","NO_NEW_ACTION","EMERGENCY_EXIT_PIPELINE"].includes(input?.route)) reasons.push("INVALID_ROUTE");
  for (const [name, value] of Object.entries({
    downstreamEntryEligible: input?.downstreamEntryEligible,
    downstreamManagementEligible: input?.downstreamManagementEligible,
    downstreamEmergencyExitEligible: input?.downstreamEmergencyExitEligible,
    downstreamReconciliationRequired: input?.downstreamReconciliationRequired,
    exactContractBound: input?.exactContractBound,
  })) if (value !== true && value !== false) reasons.push(`INVALID_${name.toUpperCase()}`);
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");
  if (reasons.length) return out("BLOCK", reasons);

  if (input.route === "BLOCKED") return out("BLOCK", ["UPSTREAM_ROUTE_BLOCKED"]);
  if (input.route === "NO_NEW_ACTION") {
    if (input.downstreamEntryEligible || input.downstreamManagementEligible || input.downstreamEmergencyExitEligible || input.downstreamReconciliationRequired) return out("BLOCK", ["INCONSISTENT_NO_ACTION_ROUTE"]);
    return out("NO_ACTION", ["NO_DOWNSTREAM_ACTION"]);
  }
  if (!input.exactContractBound) return out("BLOCK", ["EXACT_CONTRACT_NOT_BOUND"]);

  if (input.route === "SHADOW_ENTRY_PIPELINE") {
    if (!input.downstreamEntryEligible || input.downstreamManagementEligible || input.downstreamEmergencyExitEligible || input.downstreamReconciliationRequired) return out("BLOCK", ["INCONSISTENT_ENTRY_ROUTE"]);
    return out("ENTRY_STATE_READY", ["SHADOW_ENTRY_STATE_ADAPTER_READY"], { entryAuthorizationDecision: "AUTHORIZE_SIMULATION" });
  }
  if (input.route === "RECONCILIATION_PIPELINE") {
    if (!input.downstreamReconciliationRequired || input.downstreamEntryEligible || input.downstreamEmergencyExitEligible) return out("BLOCK", ["INCONSISTENT_RECONCILIATION_ROUTE"]);
    return out("RECONCILIATION_READY", ["RECONCILIATION_ADAPTER_READY"], { reconciliationRequested: true, managementRequested: input.downstreamManagementEligible });
  }
  if (input.route === "MANAGEMENT_ONLY") {
    if (!input.downstreamManagementEligible || input.downstreamEntryEligible || input.downstreamEmergencyExitEligible || input.downstreamReconciliationRequired) return out("BLOCK", ["INCONSISTENT_MANAGEMENT_ROUTE"]);
    return out("MANAGEMENT_READY", ["MANAGEMENT_ADAPTER_READY"], { managementRequested: true });
  }
  if (!input.downstreamEmergencyExitEligible || !input.downstreamManagementEligible || input.downstreamEntryEligible || input.downstreamReconciliationRequired) return out("BLOCK", ["INCONSISTENT_EMERGENCY_ROUTE"]);
  return out("EMERGENCY_EXIT_READY", ["EMERGENCY_EXIT_ADAPTER_READY"], { managementRequested: true, emergencyExitRequested: true });
}
