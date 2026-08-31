export type ExecutionAction =
  | "BLOCKED"
  | "ENTRY_ELIGIBLE_SHADOW"
  | "RECONCILE_ONLY"
  | "HALT_NEW_ACTIONS"
  | "EMERGENCY_EXIT_INTENT";

export type ShadowExecutionRoute =
  | "BLOCKED"
  | "SHADOW_ENTRY_PIPELINE"
  | "RECONCILIATION_PIPELINE"
  | "MANAGEMENT_ONLY"
  | "NO_NEW_ACTION"
  | "EMERGENCY_EXIT_PIPELINE";

export interface ShadowExecutionIntentCoordinatorInput {
  actionPlanVersion: "EXECUTION_ACTION_PLANNER_V1";
  action: ExecutionAction;
  entryIntentEligible: boolean;
  managementIntentAllowed: boolean;
  reconciliationRequired: boolean;
  emergencyExitIntentRequired: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
  exactContractBound: boolean;
  hasConfirmedOpenPosition: boolean;
  shadowEntryAuthorizationDecision?: "AUTHORIZE_SIMULATION" | "BLOCK";
  exitIntentDecision?: "READY" | "BLOCK";
  reconciliationEvidenceReady?: boolean;
}

export interface ShadowExecutionIntentCoordinatorResult {
  version: "SHADOW_EXECUTION_INTENT_COORDINATOR_V1";
  route: ShadowExecutionRoute;
  reasonCodes: string[];
  downstreamEntryEligible: boolean;
  downstreamManagementEligible: boolean;
  downstreamEmergencyExitEligible: boolean;
  downstreamReconciliationRequired: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function bool(v: unknown): v is boolean {
  return v === true || v === false;
}

function result(
  route: ShadowExecutionRoute,
  reasonCodes: string[],
  flags: Partial<Pick<
    ShadowExecutionIntentCoordinatorResult,
    "downstreamEntryEligible" | "downstreamManagementEligible" | "downstreamEmergencyExitEligible" | "downstreamReconciliationRequired"
  >> = {},
): ShadowExecutionIntentCoordinatorResult {
  return {
    version: "SHADOW_EXECUTION_INTENT_COORDINATOR_V1",
    route,
    reasonCodes,
    downstreamEntryEligible: flags.downstreamEntryEligible ?? false,
    downstreamManagementEligible: flags.downstreamManagementEligible ?? false,
    downstreamEmergencyExitEligible: flags.downstreamEmergencyExitEligible ?? false,
    downstreamReconciliationRequired: flags.downstreamReconciliationRequired ?? false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function coordinateShadowExecutionIntent(
  input: ShadowExecutionIntentCoordinatorInput,
): ShadowExecutionIntentCoordinatorResult {
  const reasons: string[] = [];

  if (input?.actionPlanVersion !== "EXECUTION_ACTION_PLANNER_V1") reasons.push("INVALID_ACTION_PLAN_VERSION");
  if (!["BLOCKED", "ENTRY_ELIGIBLE_SHADOW", "RECONCILE_ONLY", "HALT_NEW_ACTIONS", "EMERGENCY_EXIT_INTENT"].includes(input?.action)) reasons.push("INVALID_ACTION");
  if (!bool(input?.entryIntentEligible)) reasons.push("INVALID_ENTRY_ELIGIBILITY_FLAG");
  if (!bool(input?.managementIntentAllowed)) reasons.push("INVALID_MANAGEMENT_FLAG");
  if (!bool(input?.reconciliationRequired)) reasons.push("INVALID_RECONCILIATION_FLAG");
  if (!bool(input?.emergencyExitIntentRequired)) reasons.push("INVALID_EMERGENCY_EXIT_FLAG");
  if (!bool(input?.exactContractBound)) reasons.push("INVALID_CONTRACT_BINDING_STATE");
  if (!bool(input?.hasConfirmedOpenPosition)) reasons.push("INVALID_OPEN_POSITION_STATE");
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");

  if (reasons.length > 0) return result("BLOCKED", reasons);

  if (input.action === "BLOCKED") {
    return result("BLOCKED", ["UPSTREAM_ACTION_BLOCKED"]);
  }

  if (input.action === "ENTRY_ELIGIBLE_SHADOW") {
    if (!input.entryIntentEligible || input.reconciliationRequired || input.emergencyExitIntentRequired) {
      return result("BLOCKED", ["INCONSISTENT_ENTRY_ACTION_PLAN"]);
    }
    if (!input.exactContractBound) return result("BLOCKED", ["EXACT_CONTRACT_NOT_BOUND"]);
    if (input.shadowEntryAuthorizationDecision !== "AUTHORIZE_SIMULATION") {
      return result("BLOCKED", ["SHADOW_ENTRY_NOT_AUTHORIZED"]);
    }
    return result("SHADOW_ENTRY_PIPELINE", ["SHADOW_ENTRY_PIPELINE_READY"], {
      downstreamEntryEligible: true,
    });
  }

  if (input.action === "RECONCILE_ONLY") {
    if (!input.reconciliationRequired || input.entryIntentEligible || input.emergencyExitIntentRequired) {
      return result("BLOCKED", ["INCONSISTENT_RECONCILIATION_ACTION_PLAN"]);
    }
    if (input.reconciliationEvidenceReady !== true) {
      return result("BLOCKED", ["RECONCILIATION_EVIDENCE_NOT_READY"]);
    }
    return result("RECONCILIATION_PIPELINE", ["RECONCILIATION_PIPELINE_READY"], {
      downstreamManagementEligible: input.managementIntentAllowed && input.hasConfirmedOpenPosition,
      downstreamReconciliationRequired: true,
    });
  }

  if (input.action === "EMERGENCY_EXIT_INTENT") {
    if (!input.emergencyExitIntentRequired || !input.managementIntentAllowed || input.entryIntentEligible) {
      return result("BLOCKED", ["INCONSISTENT_EMERGENCY_ACTION_PLAN"]);
    }
    if (!input.hasConfirmedOpenPosition) return result("BLOCKED", ["EMERGENCY_EXIT_WITHOUT_CONFIRMED_POSITION"]);
    if (!input.exactContractBound) return result("BLOCKED", ["EMERGENCY_CONTRACT_NOT_BOUND"]);
    if (input.exitIntentDecision !== "READY") return result("BLOCKED", ["EMERGENCY_EXIT_INTENT_NOT_READY"]);
    return result("EMERGENCY_EXIT_PIPELINE", ["EMERGENCY_EXIT_PIPELINE_READY"], {
      downstreamManagementEligible: true,
      downstreamEmergencyExitEligible: true,
    });
  }

  if (input.entryIntentEligible || input.reconciliationRequired || input.emergencyExitIntentRequired) {
    return result("BLOCKED", ["INCONSISTENT_HALT_ACTION_PLAN"]);
  }

  if (input.managementIntentAllowed && input.hasConfirmedOpenPosition) {
    return result("MANAGEMENT_ONLY", ["MANAGEMENT_ONLY_ALLOWED"], {
      downstreamManagementEligible: true,
    });
  }

  return result("NO_NEW_ACTION", ["NEW_ACTIONS_HALTED"]);
}
