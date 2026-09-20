import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";
import type {
  ExecutionLevelPlanInput,
  ExecutionLevelPlanResult,
} from "./execution-level-plan.js";

export const CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1 = "CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1" as const;

export interface CanonicalExecutionLevelPlanBindingInput {
  consumer: CanonicalBusinessConsumerResult | null;
  /**
   * Observation-only until a canonical execution-level evidence producer is
   * explicitly bound. Raw caller values must never become execution authority.
   */
  planInput?: ExecutionLevelPlanInput | null;
}

export interface CanonicalExecutionLevelPlanBindingResult {
  version: typeof CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1;
  decision: "BLOCK";
  decisionId: string | null;
  candidateKey: string | null;
  identityLocked: boolean;
  plan: ExecutionLevelPlanResult | null;
  blockers: string[];
  readOnly: true;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

/**
 * Identity firewall only.
 *
 * The repository currently has EXECUTION_LEVEL_PLAN_V1, but no canonical
 * producer that proves entryPremium + invalidationPremium for the locked
 * EXECUTION_CANDIDATE_SELECTOR_V2 candidate. Legacy TM_V1 is explicitly
 * UNCALIBRATED_FORWARD_TEST_ONLY and belongs to a different candidate path.
 *
 * Therefore this boundary may prove candidate identity, but it MUST NOT turn
 * caller-supplied numbers into a READY execution plan. Once an approved,
 * candidate-bound level-evidence producer exists, this boundary can be
 * extended to invoke the existing execution-level calculator.
 */
export function bindCanonicalExecutionLevelPlan(
  input: CanonicalExecutionLevelPlanBindingInput,
): CanonicalExecutionLevelPlanBindingResult {
  const consumer = input?.consumer ?? null;
  const candidate = consumer?.buyerCandidate ?? null;
  const blockers: string[] = [];

  if (!candidate) blockers.push("CANONICAL_BUSINESS_CANDIDATE_REQUIRED");
  if (!consumer?.decisionId || !candidate?.decisionId || consumer.decisionId !== candidate.decisionId) {
    blockers.push("CANONICAL_DECISION_IDENTITY_REQUIRED");
  }
  if (!consumer?.candidateKey || !candidate?.candidateKey || consumer.candidateKey !== candidate.candidateKey) {
    blockers.push("CANONICAL_CANDIDATE_IDENTITY_REQUIRED");
  }
  if (candidate?.sourceAuthority !== "EXECUTION_CANDIDATE_SELECTOR_V2") {
    blockers.push("AUTHORITATIVE_SELECTOR_SOURCE_REQUIRED");
  }
  if (consumer?.sameCanonicalCandidateForDashboardAndTelegram !== true) {
    blockers.push("CANONICAL_DASHBOARD_TELEGRAM_IDENTITY_REQUIRED");
  }
  if (candidate && input?.planInput?.symbol && input.planInput.symbol !== candidate.symbol) {
    blockers.push("EXECUTION_LEVEL_PLAN_SYMBOL_MISMATCH");
  }

  const identityLocked = blockers.length === 0;
  if (identityLocked) blockers.push("EXECUTION_LEVEL_EVIDENCE_SOURCE_NOT_BOUND");

  return {
    version: CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1,
    decision: "BLOCK",
    decisionId: identityLocked ? consumer!.decisionId : null,
    candidateKey: identityLocked ? consumer!.candidateKey : null,
    identityLocked,
    plan: null,
    blockers: [...new Set(blockers)],
    readOnly: true,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
