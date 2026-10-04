import type { H1SelectorCanonicalValidationProof } from "./h1-selector-canonical-policy-source.js";
import {
  runH1SelectorProspectiveEvidenceReadbackV1,
} from "./h1-selector-prospective-evidence-readback-v1.js";
import {
  validateH1SelectorThreePolicyBundle,
  type H1SelectorThreePolicyValidationInput,
  type H1SelectorThreePolicyValidationResult,
} from "./h1-selector-three-policy-validation-v1.js";

export const H1_SELECTOR_THREE_POLICY_VALIDATION_ENV =
  "KITE_H1_THREE_POLICY_VALIDATION_JSON" as const;

type ProspectiveReadback = Awaited<ReturnType<typeof runH1SelectorProspectiveEvidenceReadbackV1>>;

export interface H1SelectorCanonicalValidationHandoffResult {
  version: "H1_SELECTOR_CANONICAL_VALIDATION_HANDOFF_V1";
  readyForCanonicalPolicySource: boolean;
  proof: H1SelectorCanonicalValidationProof;
  blockers: string[];
  source: "EXPLICIT_VALIDATED_EVIDENCE_HANDOFF" | "NONE";
  productionImpact: "NONE";
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseThreePolicyValidation(
  raw: string | undefined,
): { result: H1SelectorThreePolicyValidationResult | null; blocker: string | null } {
  if (!raw?.trim()) {
    return { result: null, blocker: "KITE_H1_THREE_POLICY_VALIDATION_JSON_REQUIRED" };
  }
  try {
    const parsed = JSON.parse(raw) as H1SelectorThreePolicyValidationInput;
    const result = validateH1SelectorThreePolicyBundle(parsed);
    return { result, blocker: null };
  } catch {
    return { result: null, blocker: "KITE_H1_THREE_POLICY_VALIDATION_JSON_INVALID" };
  }
}

export function buildH1SelectorCanonicalValidationHandoffFromEvidenceV1(
  prospective: ProspectiveReadback,
  env: NodeJS.ProcessEnv = process.env,
): H1SelectorCanonicalValidationHandoffResult {
  const blockers = [...prospective.blockers];

  if (!prospective.evaluation) {
    blockers.push("PROSPECTIVE_VALIDATION_EVALUATION_REQUIRED");
  }
  if (!finite(prospective.direction.p75ThresholdPct)) {
    blockers.push("DIRECTION_VALIDATED_THRESHOLD_REQUIRED");
  }
  if (!prospective.greeks.policySnapshot) {
    blockers.push("GREEK_VALIDATED_POLICY_SNAPSHOT_REQUIRED");
  }

  const threePolicy = parseThreePolicyValidation(env[H1_SELECTOR_THREE_POLICY_VALIDATION_ENV]);
  if (threePolicy.blocker) blockers.push(threePolicy.blocker);
  if (threePolicy.result) blockers.push(...threePolicy.result.blockers);

  const proof: H1SelectorCanonicalValidationProof = {
    prospectiveEvaluation: prospective.evaluation,
    directionThresholdPct: prospective.direction.p75ThresholdPct,
    greekPolicySnapshot: prospective.greeks.policySnapshot,
    threePolicyValidation: threePolicy.result,
  };

  const uniqueBlockers = [...new Set(blockers)];
  const ready =
    uniqueBlockers.length === 0 &&
    prospective.evaluation?.readyForOwnerPromotionReview === true &&
    prospective.evaluation.directionPass === true &&
    prospective.evaluation.greekPass === true &&
    threePolicy.result?.readyForCanonicalPolicySource === true;

  return {
    version: "H1_SELECTOR_CANONICAL_VALIDATION_HANDOFF_V1",
    readyForCanonicalPolicySource: ready,
    proof,
    blockers: uniqueBlockers,
    source: ready ? "EXPLICIT_VALIDATED_EVIDENCE_HANDOFF" : "NONE",
    productionImpact: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

export async function buildH1SelectorCanonicalValidationHandoffV1(
  env: NodeJS.ProcessEnv = process.env,
): Promise<H1SelectorCanonicalValidationHandoffResult> {
  const prospective = await runH1SelectorProspectiveEvidenceReadbackV1();
  return buildH1SelectorCanonicalValidationHandoffFromEvidenceV1(prospective, env);
}
