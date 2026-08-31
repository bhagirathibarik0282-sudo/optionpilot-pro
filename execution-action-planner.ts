export type ConsistencyState = "READY" | "RECONCILE" | "HALT" | "EMERGENCY";

export interface ExecutionConsistencySnapshotInput {
  version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
  state: ConsistencyState;
  newEntryAllowed: boolean;
  managementAllowed: boolean;
  emergencyExitRequired: boolean;
  brokerOrderAllowed: false;
  placesOrder: false;
  failClosed: true;
}

export type ExecutionAction =
  | "BLOCKED"
  | "ENTRY_ELIGIBLE_SHADOW"
  | "RECONCILE_ONLY"
  | "HALT_NEW_ACTIONS"
  | "EMERGENCY_EXIT_INTENT";

export interface ExecutionActionPlan {
  version: "EXECUTION_ACTION_PLANNER_V1";
  action: ExecutionAction;
  entryIntentEligible: boolean;
  managementIntentAllowed: boolean;
  reconciliationRequired: boolean;
  emergencyExitIntentRequired: boolean;
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

function plan(
  action: ExecutionAction,
  reasonCodes: string[],
  managementIntentAllowed = false,
): ExecutionActionPlan {
  return {
    version: "EXECUTION_ACTION_PLANNER_V1",
    action,
    entryIntentEligible: action === "ENTRY_ELIGIBLE_SHADOW",
    managementIntentAllowed,
    reconciliationRequired: action === "RECONCILE_ONLY",
    emergencyExitIntentRequired: action === "EMERGENCY_EXIT_INTENT",
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function planExecutionAction(
  snapshot: ExecutionConsistencySnapshotInput,
): ExecutionActionPlan {
  const reasons: string[] = [];

  if (snapshot?.version !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1") reasons.push("INVALID_SNAPSHOT_VERSION");
  if (!["READY", "RECONCILE", "HALT", "EMERGENCY"].includes(snapshot?.state)) reasons.push("INVALID_CONSISTENCY_STATE");
  if (!bool(snapshot?.newEntryAllowed)) reasons.push("INVALID_NEW_ENTRY_FLAG");
  if (!bool(snapshot?.managementAllowed)) reasons.push("INVALID_MANAGEMENT_FLAG");
  if (!bool(snapshot?.emergencyExitRequired)) reasons.push("INVALID_EMERGENCY_EXIT_FLAG");
  if (snapshot?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (snapshot?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (snapshot?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");

  if (reasons.length > 0) return plan("BLOCKED", reasons);

  if (snapshot.state === "EMERGENCY") {
    if (snapshot.newEntryAllowed || !snapshot.managementAllowed || !snapshot.emergencyExitRequired) {
      return plan("BLOCKED", ["INCONSISTENT_EMERGENCY_SNAPSHOT"]);
    }
    return plan("EMERGENCY_EXIT_INTENT", ["EMERGENCY_EXIT_INTENT_REQUIRED"], true);
  }

  if (snapshot.emergencyExitRequired) {
    return plan("BLOCKED", ["EMERGENCY_FLAG_OUTSIDE_EMERGENCY_STATE"]);
  }

  if (snapshot.state === "RECONCILE") {
    if (snapshot.newEntryAllowed) return plan("BLOCKED", ["RECONCILE_CANNOT_ALLOW_NEW_ENTRY"]);
    return plan("RECONCILE_ONLY", ["RECONCILIATION_REQUIRED"], snapshot.managementAllowed);
  }

  if (snapshot.state === "HALT") {
    if (snapshot.newEntryAllowed) return plan("BLOCKED", ["HALT_CANNOT_ALLOW_NEW_ENTRY"]);
    return plan("HALT_NEW_ACTIONS", ["NEW_ACTIONS_HALTED"], snapshot.managementAllowed);
  }

  if (!snapshot.newEntryAllowed) {
    return plan("BLOCKED", ["READY_STATE_WITHOUT_ENTRY_ELIGIBILITY"]);
  }

  return plan("ENTRY_ELIGIBLE_SHADOW", ["SHADOW_ENTRY_ELIGIBLE"], snapshot.managementAllowed);
}
