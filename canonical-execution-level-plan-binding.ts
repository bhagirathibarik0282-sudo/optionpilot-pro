import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";
import {
  buildExecutionLevelPlan,
  type ExecutionLevelPlanInput,
  type ExecutionLevelPlanResult,
} from "./execution-level-plan.js";

export const CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1 = "CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1" as const;

export interface CanonicalExecutionLevelPlanBindingInput {
  consumer: CanonicalBusinessConsumerResult | null;
  planInput: ExecutionLevelPlanInput;
}

export interface CanonicalExecutionLevelPlanBindingResult {
  version: typeof CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1;
  decision: "READY" | "BLOCK";
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
  if (candidate && input?.planInput?.symbol !== candidate.symbol) {
    blockers.push("EXECUTION_LEVEL_PLAN_SYMBOL_MISMATCH");
  }

  const identityLocked = blockers.length === 0;
  const plan = identityLocked ? buildExecutionLevelPlan(input.planInput) : null;
  if (plan?.decision !== "READY") {
    for (const reason of plan?.reasonCodes ?? []) {
      if (reason !== "EXECUTION_LEVEL_PLAN_READY") blockers.push(reason);
    }
  }

  const ready = identityLocked && plan?.decision === "READY" && blockers.length === 0;

  return {
    version: CANONICAL_EXECUTION_LEVEL_PLAN_BINDING_V1,
    decision: ready ? "READY" : "BLOCK",
    decisionId: identityLocked ? consumer!.decisionId : null,
    candidateKey: identityLocked ? consumer!.candidateKey : null,
    identityLocked,
    plan,
    blockers: ready ? [] : [...new Set(blockers)],
    readOnly: true,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
