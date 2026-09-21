import type { CanonicalEvidenceEnvelope } from "./canonical-evidence-envelope.js";
import type { ExecutionCandidateInput, ExecutionCandidateResult } from "./execution-candidate-selector.js";

export const JEV_DECISION_SHADOW_VERSION = "JEV_DECISION_SHADOW_V1" as const;
export const JEV_PINNED_MODEL = "typesafe/jev-1.13" as const;
export const JEV_DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions" as const;
export const JEV_MAX_BATCH = 20 as const;

export type JevShadowQuestion =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export interface JevDecisionShadowSample {
  sampleId: string;
  candidate: ExecutionCandidateInput;
  envelope: CanonicalEvidenceEnvelope;
  baselineSelector: ExecutionCandidateResult;
}

export interface JevDecisionShadowRequest {
  model: typeof JEV_PINNED_MODEL;
  state: {
    description: string;
    records: Array<{ id: string; record: string }>;
  };
  questions: Record<string, JevShadowQuestion>;
}

export interface JevDecisionShadowPlan {
  version: typeof JEV_DECISION_SHADOW_VERSION;
  semantics: "RESEARCH_SHADOW_ONLY";
  request: JevDecisionShadowRequest;
  baseline: Array<{
    sampleId: string;
    selectorDecision: ExecutionCandidateResult["decision"];
    selectorCandidateKey: string | null;
    selectorReasonCodes: readonly string[];
  }>;
  blockers: string[];
  affectsVerdict: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
  futureOutcomeIncluded: false;
}

export interface JevDecisionShadowApiResponse {
  answers: Record<string, unknown>;
  model: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
  id?: string;
  provider?: string;
}

function exactCandidateKey(candidate: ExecutionCandidateInput): string {
  return `${candidate.symbol}:${candidate.side}:${candidate.strike}:${candidate.expiryDate}:DTE${candidate.dte}:${candidate.moneyness}`;
}

function validateSample(sample: JevDecisionShadowSample, seen: Set<string>): string[] {
  const blockers: string[] = [];
  const id = sample.sampleId?.trim();
  if (!id) blockers.push("JEV_SAMPLE_ID_REQUIRED");
  else if (seen.has(id)) blockers.push(`JEV_DUPLICATE_SAMPLE_ID:${id}`);
  else seen.add(id);

  if (sample.envelope?.ruleVersion !== "CANONICAL_EVIDENCE_ENVELOPE_V1") {
    blockers.push(`JEV_CANONICAL_ENVELOPE_REQUIRED:${id || "UNKNOWN"}`);
  }
  if (sample.envelope?.semantics !== "RESEARCH_SHADOW_ONLY") {
    blockers.push(`JEV_ENVELOPE_NOT_RESEARCH_SHADOW:${id || "UNKNOWN"}`);
  }
  if (
    sample.envelope?.affectsVerdict !== false ||
    sample.envelope?.affectsTelegram !== false ||
    sample.envelope?.affectsExecution !== false ||
    sample.envelope?.aiMayOverride !== false
  ) {
    blockers.push(`JEV_ENVELOPE_AUTHORITY_BOUNDARY_INVALID:${id || "UNKNOWN"}`);
  }
  if (sample.envelope?.symbol !== sample.candidate?.symbol) {
    blockers.push(`JEV_SYMBOL_MISMATCH:${id || "UNKNOWN"}`);
  }
  if (sample.baselineSelector?.version !== "EXECUTION_CANDIDATE_SELECTOR_V2") {
    blockers.push(`JEV_BASELINE_SELECTOR_VERSION_INVALID:${id || "UNKNOWN"}`);
  }
  if (sample.baselineSelector?.decision === "SELECT") {
    const expected = exactCandidateKey(sample.candidate);
    if (sample.baselineSelector.candidateKey !== expected) {
      blockers.push(`JEV_BASELINE_SELECTOR_IDENTITY_MISMATCH:${id || "UNKNOWN"}`);
    }
  }
  return blockers;
}

function recordFor(sample: JevDecisionShadowSample): string {
  return JSON.stringify({
    sampleId: sample.sampleId,
    candidate: sample.candidate,
    evidence: sample.envelope,
    constraints: {
      optionBuyerOnly: true,
      useOnlySuppliedEvidence: true,
      doNotInferMissingMarketData: true,
      futureOutcomeHidden: true,
      decisionIsResearchShadowOnly: true,
    },
  });
}

function questionsFor(sampleId: string): Record<string, JevShadowQuestion> {
  const prefix = sampleId.replace(/[^A-Za-z0-9_-]/g, "_");
  return {
    [`${prefix}__action`]: {
      type: "choice",
      instructions: `For record "${sampleId}", decide whether the exact supplied option-buying candidate should be TAKEN or rejected as NO_TRADE using only the supplied decision-time evidence. Do not invent missing data and do not use future outcomes.`,
      criteria: {
        TAKE_CANDIDATE: "The exact candidate is sufficiently supported by coherent, fresh, non-conflicting evidence and its supplied option-buying constraints.",
        NO_TRADE: "The exact candidate is not sufficiently supported because evidence is stale, missing, conflicting, weak, or the supplied option-buying constraints are not satisfied.",
      },
    },
    [`${prefix}__evidence_consistent`]: {
      type: "noul",
      instructions: `For record "${sampleId}", is the supplied decision-time evidence internally consistent for this exact candidate?`,
      criteria: {
        true: "The supplied evidence is materially coherent and mutually supportive.",
        false: "The supplied evidence is materially contradictory, incomplete, stale, or insufficient.",
      },
    },
    [`${prefix}__material_conflict`]: {
      type: "noul",
      instructions: `For record "${sampleId}", is there a material conflict that should stop an option buyer from taking this exact candidate?`,
      criteria: {
        true: "At least one material conflict or missing requirement should block the candidate.",
        false: "No material conflict or missing requirement is evident in the supplied evidence.",
      },
    },
    [`${prefix}__quality`]: {
      type: "score",
      instructions: `For record "${sampleId}", rate the overall quality of the exact option-buying candidate from the supplied evidence only.`,
      criteria: ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
    },
  };
}

export function buildJevDecisionShadowPlan(samples: JevDecisionShadowSample[]): JevDecisionShadowPlan {
  const blockers: string[] = [];
  if (!Array.isArray(samples) || samples.length === 0) blockers.push("JEV_SAMPLES_REQUIRED");
  if (samples.length > JEV_MAX_BATCH) blockers.push("JEV_BATCH_EXCEEDS_20");

  const seen = new Set<string>();
  for (const sample of samples) blockers.push(...validateSample(sample, seen));

  const safeSamples = blockers.length === 0 ? samples : [];
  const records = safeSamples.map((sample) => ({ id: sample.sampleId, record: recordFor(sample) }));
  const questions = Object.assign({}, ...safeSamples.map((sample) => questionsFor(sample.sampleId)));

  return {
    version: JEV_DECISION_SHADOW_VERSION,
    semantics: "RESEARCH_SHADOW_ONLY",
    request: {
      model: JEV_PINNED_MODEL,
      state: {
        description: "OptionPilot decision-time option-buying candidate evidence. Each record is independent. Future outcomes are intentionally hidden.",
        records,
      },
      questions,
    },
    baseline: safeSamples.map((sample) => ({
      sampleId: sample.sampleId,
      selectorDecision: sample.baselineSelector.decision,
      selectorCandidateKey: sample.baselineSelector.candidateKey,
      selectorReasonCodes: sample.baselineSelector.reasonCodes,
    })),
    blockers,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
    futureOutcomeIncluded: false,
  };
}

export async function callJevDecisionShadow(
  plan: JevDecisionShadowPlan,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JevDecisionShadowApiResponse> {
  if (plan.blockers.length > 0) throw new Error(`JEV_SHADOW_PLAN_BLOCKED:${plan.blockers.join(",")}`);
  const key = apiKey?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY_REQUIRED");

  const response = await fetchImpl(JEV_DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(plan.request),
  });

  if (!response.ok) throw new Error(`JEV_DECISIONS_HTTP_${response.status}`);
  const json = await response.json() as JevDecisionShadowApiResponse;
  if (!json || typeof json !== "object" || !json.answers || typeof json.answers !== "object") {
    throw new Error("JEV_DECISIONS_RESPONSE_INVALID");
  }
  return json;
}
