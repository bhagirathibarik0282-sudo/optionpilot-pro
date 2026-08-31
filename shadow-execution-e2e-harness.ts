import { planExecutionAction, type ExecutionConsistencySnapshotInput } from "./execution-action-planner.js";
import { coordinateShadowExecutionIntent } from "./shadow-execution-intent-coordinator.js";
import { adaptShadowExecutionRoute } from "./shadow-execution-route-adapter.js";
import { bridgeShadowDownstreamState } from "./shadow-downstream-state-bridge.js";

export interface ShadowExecutionE2EHarnessInput {
  snapshot: ExecutionConsistencySnapshotInput;
  exactContractBound: boolean;
  hasConfirmedOpenPosition: boolean;
  shadowEntryAuthorizationDecision?: "AUTHORIZE_SIMULATION" | "BLOCK";
  exitIntentDecision?: "READY" | "BLOCK";
  reconciliationEvidenceReady?: boolean;
}

export interface ShadowExecutionE2EHarnessResult {
  version: "SHADOW_EXECUTION_E2E_HARNESS_V1";
  action: string;
  route: string;
  adapterDecision: string;
  target: string;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function blocked(reasonCodes: string[]): ShadowExecutionE2EHarnessResult {
  return {
    version: "SHADOW_EXECUTION_E2E_HARNESS_V1",
    action: "BLOCKED",
    route: "BLOCKED",
    adapterDecision: "BLOCK",
    target: "BLOCKED",
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function runShadowExecutionE2EHarness(input: ShadowExecutionE2EHarnessInput): ShadowExecutionE2EHarnessResult {
  if (input?.exactContractBound !== true && input?.exactContractBound !== false) return blocked(["INVALID_CONTRACT_BINDING_STATE"]);
  if (input?.hasConfirmedOpenPosition !== true && input?.hasConfirmedOpenPosition !== false) return blocked(["INVALID_OPEN_POSITION_STATE"]);

  const actionPlan = planExecutionAction(input.snapshot);
  if (actionPlan.action === "BLOCKED") return blocked(actionPlan.reasonCodes);

  const coordinated = coordinateShadowExecutionIntent({
    actionPlanVersion: actionPlan.version,
    action: actionPlan.action,
    entryIntentEligible: actionPlan.entryIntentEligible,
    managementIntentAllowed: actionPlan.managementIntentAllowed,
    reconciliationRequired: actionPlan.reconciliationRequired,
    emergencyExitIntentRequired: actionPlan.emergencyExitIntentRequired,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
    exactContractBound: input.exactContractBound,
    hasConfirmedOpenPosition: input.hasConfirmedOpenPosition,
    shadowEntryAuthorizationDecision: input.shadowEntryAuthorizationDecision,
    exitIntentDecision: input.exitIntentDecision,
    reconciliationEvidenceReady: input.reconciliationEvidenceReady,
  });
  if (coordinated.route === "BLOCKED") return blocked(coordinated.reasonCodes);

  const adapted = adaptShadowExecutionRoute({
    coordinatorVersion: coordinated.version,
    route: coordinated.route,
    downstreamEntryEligible: coordinated.downstreamEntryEligible,
    downstreamManagementEligible: coordinated.downstreamManagementEligible,
    downstreamEmergencyExitEligible: coordinated.downstreamEmergencyExitEligible,
    downstreamReconciliationRequired: coordinated.downstreamReconciliationRequired,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
    exactContractBound: input.exactContractBound,
  });
  if (adapted.adapterDecision === "BLOCK") return blocked(adapted.reasonCodes);

  const bridged = bridgeShadowDownstreamState({
    adapterVersion: adapted.version,
    adapterDecision: adapted.adapterDecision,
    entryAuthorizationDecision: adapted.entryAuthorizationDecision,
    reconciliationRequested: adapted.reconciliationRequested,
    managementRequested: adapted.managementRequested,
    emergencyExitRequested: adapted.emergencyExitRequested,
    exactContractBound: input.exactContractBound,
    hasConfirmedOpenPosition: input.hasConfirmedOpenPosition,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  });

  return {
    version: "SHADOW_EXECUTION_E2E_HARNESS_V1",
    action: actionPlan.action,
    route: coordinated.route,
    adapterDecision: adapted.adapterDecision,
    target: bridged.target,
    reasonCodes: bridged.reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
