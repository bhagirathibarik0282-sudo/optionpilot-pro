import type { KiteExecutionShadowResult } from "./kite-execution-shadow-v1.js";
import type { BrokerOrderBuilderResult } from "./broker-order-builder.js";
import type { BrokerExecutionAuthorizationResult } from "./broker-execution-authorization.js";

export const REAL_EXECUTION_READINESS_V1 = "REAL_EXECUTION_READINESS_V1" as const;

export interface RealExecutionReadinessInput {
  shadow: KiteExecutionShadowResult | null;
  order: BrokerOrderBuilderResult | null;
  authorization: BrokerExecutionAuthorizationResult | null;
  executionRiskDecision: "ALLOW" | "BLOCK";
  killSwitchDecision: "ALLOW" | "BLOCK";
  idempotencyDecision: "ALLOW" | "BLOCK";
  brokerSessionReady: boolean;
  evidencePersistenceConfirmed: boolean;
  rejectionHandlingReady: boolean;
  reconciliationReady: boolean;
  auditTrailReady: boolean;
}

export interface RealExecutionReadinessResult {
  version: typeof REAL_EXECUTION_READINESS_V1;
  readyForLiveEnablementReview: boolean;
  decision: "READY_FOR_HUMAN_ENABLEMENT_REVIEW" | "BLOCK";
  blockers: string[];
  candidateKey: string | null;
  orderIntentBuilt: boolean;
  shadowSimulationAuthorized: boolean;
  liveExecutionEnabled: false;
  requiresExplicitHumanApproval: true;
  placesOrder: false;
  brokerCallMade: false;
  failClosed: true;
}

export function evaluateRealExecutionReadiness(input: RealExecutionReadinessInput): RealExecutionReadinessResult {
  const blockers:string[]=[];
  if (input?.shadow?.decision !== "SHADOW_READY") blockers.push("KITE_SHADOW_NOT_READY");
  if (!input?.shadow?.candidateKey) blockers.push("CANONICAL_CANDIDATE_NOT_BOUND");
  if (input?.order?.decision !== "BUILD" || !input.order.intent) blockers.push("PROTECTED_ORDER_INTENT_NOT_BUILT");
  if (input?.executionRiskDecision !== "ALLOW") blockers.push("EXECUTION_RISK_NOT_CLEAR");
  if (input?.killSwitchDecision !== "ALLOW") blockers.push("KILL_SWITCH_NOT_CLEAR");
  if (input?.idempotencyDecision !== "ALLOW") blockers.push("IDEMPOTENCY_NOT_CLEAR");
  if (input?.brokerSessionReady !== true) blockers.push("BROKER_SESSION_NOT_READY");
  if (input?.evidencePersistenceConfirmed !== true) blockers.push("EVIDENCE_PERSISTENCE_NOT_READY");
  if (input?.rejectionHandlingReady !== true) blockers.push("REJECTION_HANDLING_NOT_READY");
  if (input?.reconciliationReady !== true) blockers.push("ORDER_RECONCILIATION_NOT_READY");
  if (input?.auditTrailReady !== true) blockers.push("AUDIT_TRAIL_NOT_READY");
  if (input?.authorization?.decision !== "AUTHORIZE_SIMULATION") blockers.push("SHADOW_BROKER_AUTHORIZATION_NOT_READY");
  if (input?.authorization?.placesOrder !== false || input?.authorization?.shadowOnly !== true) blockers.push("AUTHORIZATION_BOUNDARY_UNSAFE");

  const ready=blockers.length===0;
  return {
    version:REAL_EXECUTION_READINESS_V1,readyForLiveEnablementReview:ready,
    decision:ready?"READY_FOR_HUMAN_ENABLEMENT_REVIEW":"BLOCK",blockers:[...new Set(blockers)],
    candidateKey:input?.shadow?.candidateKey ?? null,orderIntentBuilt:input?.order?.decision==="BUILD" && Boolean(input.order.intent),
    shadowSimulationAuthorized:input?.authorization?.decision==="AUTHORIZE_SIMULATION",
    liveExecutionEnabled:false,requiresExplicitHumanApproval:true,placesOrder:false,brokerCallMade:false,failClosed:true,
  };
}
