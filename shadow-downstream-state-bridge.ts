export type RouteAdapterDecision =
  | "BLOCK"
  | "ENTRY_STATE_READY"
  | "RECONCILIATION_READY"
  | "MANAGEMENT_READY"
  | "NO_ACTION"
  | "EMERGENCY_EXIT_READY";

export type ShadowDownstreamTarget =
  | "BLOCKED"
  | "SHADOW_SUBMISSION_STATE"
  | "RECONCILIATION_ENGINE"
  | "MANAGEMENT_ENGINE"
  | "EXIT_INTENT_STATE"
  | "NONE";

export interface ShadowDownstreamStateBridgeInput {
  adapterVersion: "SHADOW_EXECUTION_ROUTE_ADAPTER_V1";
  adapterDecision: RouteAdapterDecision;
  entryAuthorizationDecision: "AUTHORIZE_SIMULATION" | "BLOCK";
  reconciliationRequested: boolean;
  managementRequested: boolean;
  emergencyExitRequested: boolean;
  exactContractBound: boolean;
  hasConfirmedOpenPosition: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowDownstreamStateBridgeResult {
  version: "SHADOW_DOWNSTREAM_STATE_BRIDGE_V1";
  target: ShadowDownstreamTarget;
  simulationAuthorizationDecision: "AUTHORIZE_SIMULATION" | "BLOCK";
  requestedExitReason: "EMERGENCY" | null;
  requiresBrokerStateFacts: boolean;
  requiresReconciliationFacts: boolean;
  requiresManagementFacts: boolean;
  requiresExitStateFacts: boolean;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function bool(v: unknown): v is boolean {
  return v === true || v === false;
}

function out(
  target: ShadowDownstreamTarget,
  reasonCodes: string[],
  flags: Partial<Pick<ShadowDownstreamStateBridgeResult,
    "simulationAuthorizationDecision" | "requestedExitReason" | "requiresBrokerStateFacts" |
    "requiresReconciliationFacts" | "requiresManagementFacts" | "requiresExitStateFacts">> = {},
): ShadowDownstreamStateBridgeResult {
  return {
    version: "SHADOW_DOWNSTREAM_STATE_BRIDGE_V1",
    target,
    simulationAuthorizationDecision: flags.simulationAuthorizationDecision ?? "BLOCK",
    requestedExitReason: flags.requestedExitReason ?? null,
    requiresBrokerStateFacts: flags.requiresBrokerStateFacts ?? false,
    requiresReconciliationFacts: flags.requiresReconciliationFacts ?? false,
    requiresManagementFacts: flags.requiresManagementFacts ?? false,
    requiresExitStateFacts: flags.requiresExitStateFacts ?? false,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function bridgeShadowDownstreamState(input: ShadowDownstreamStateBridgeInput): ShadowDownstreamStateBridgeResult {
  const reasons: string[] = [];
  if (input?.adapterVersion !== "SHADOW_EXECUTION_ROUTE_ADAPTER_V1") reasons.push("INVALID_ADAPTER_VERSION");
  if (!["BLOCK","ENTRY_STATE_READY","RECONCILIATION_READY","MANAGEMENT_READY","NO_ACTION","EMERGENCY_EXIT_READY"].includes(input?.adapterDecision)) reasons.push("INVALID_ADAPTER_DECISION");
  for (const [name, value] of Object.entries({
    reconciliationRequested: input?.reconciliationRequested,
    managementRequested: input?.managementRequested,
    emergencyExitRequested: input?.emergencyExitRequested,
    exactContractBound: input?.exactContractBound,
    hasConfirmedOpenPosition: input?.hasConfirmedOpenPosition,
  })) if (!bool(value)) reasons.push(`INVALID_${name.toUpperCase()}`);
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");
  if (reasons.length) return out("BLOCKED", reasons);

  if (input.adapterDecision === "BLOCK") return out("BLOCKED", ["UPSTREAM_ADAPTER_BLOCKED"]);

  if (input.adapterDecision === "NO_ACTION") {
    if (input.entryAuthorizationDecision !== "BLOCK" || input.reconciliationRequested || input.managementRequested || input.emergencyExitRequested) {
      return out("BLOCKED", ["INCONSISTENT_NO_ACTION_ADAPTER"]);
    }
    return out("NONE", ["NO_DOWNSTREAM_STATE_HANDOFF"]);
  }

  if (!input.exactContractBound) return out("BLOCKED", ["EXACT_CONTRACT_NOT_BOUND"]);

  if (input.adapterDecision === "ENTRY_STATE_READY") {
    if (input.entryAuthorizationDecision !== "AUTHORIZE_SIMULATION" || input.reconciliationRequested || input.managementRequested || input.emergencyExitRequested) {
      return out("BLOCKED", ["INCONSISTENT_ENTRY_ADAPTER"]);
    }
    return out("SHADOW_SUBMISSION_STATE", ["SHADOW_SUBMISSION_STATE_HANDOFF_READY"], {
      simulationAuthorizationDecision: "AUTHORIZE_SIMULATION",
      requiresBrokerStateFacts: true,
    });
  }

  if (input.adapterDecision === "RECONCILIATION_READY") {
    if (input.entryAuthorizationDecision !== "BLOCK" || !input.reconciliationRequested || input.emergencyExitRequested) {
      return out("BLOCKED", ["INCONSISTENT_RECONCILIATION_ADAPTER"]);
    }
    return out("RECONCILIATION_ENGINE", ["RECONCILIATION_HANDOFF_READY"], {
      requiresReconciliationFacts: true,
      requiresManagementFacts: input.managementRequested,
    });
  }

  if (input.adapterDecision === "MANAGEMENT_READY") {
    if (input.entryAuthorizationDecision !== "BLOCK" || input.reconciliationRequested || !input.managementRequested || input.emergencyExitRequested) {
      return out("BLOCKED", ["INCONSISTENT_MANAGEMENT_ADAPTER"]);
    }
    if (!input.hasConfirmedOpenPosition) return out("BLOCKED", ["MANAGEMENT_WITHOUT_CONFIRMED_POSITION"]);
    return out("MANAGEMENT_ENGINE", ["MANAGEMENT_HANDOFF_READY"], { requiresManagementFacts: true });
  }

  if (input.entryAuthorizationDecision !== "BLOCK" || input.reconciliationRequested || !input.managementRequested || !input.emergencyExitRequested) {
    return out("BLOCKED", ["INCONSISTENT_EMERGENCY_EXIT_ADAPTER"]);
  }
  if (!input.hasConfirmedOpenPosition) return out("BLOCKED", ["EMERGENCY_EXIT_WITHOUT_CONFIRMED_POSITION"]);
  return out("EXIT_INTENT_STATE", ["EMERGENCY_EXIT_STATE_HANDOFF_READY"], {
    requestedExitReason: "EMERGENCY",
    requiresManagementFacts: true,
    requiresExitStateFacts: true,
  });
}
