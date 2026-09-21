import {
  assembleLiveExecutionCandidateInput,
  type LiveGateEvidencePacket,
} from "./h1-live-gate-evidence-assembler.js";
import {
  selectExecutionCandidate,
  type ExecutionCandidateInput,
  type ExecutionCandidateResult,
} from "./execution-candidate-selector.js";

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
  evidencePacket: LiveGateEvidencePacket;
  baselineSelector: ExecutionCandidateResult;
}

export interface JevDecisionShadowSampleBuildResult {
  sample: JevDecisionShadowSample | null;
  blockers: string[];
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
  sourcePolicy: "PERSISTED_OR_LIVE_H1_EXACT_GATE_PACKET_ONLY";
  request: JevDecisionShadowRequest;
  baseline: Array<{
    sampleId: string;
    decisionTimestamp: string;
    symbol: ExecutionCandidateInput["symbol"];
    side: ExecutionCandidateInput["side"];
    strike: number;
    expiryDate: string;
    dte: number;
    moneyness: ExecutionCandidateInput["moneyness"];
    premiumLtp: number;
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

function validSampleId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function timestampAtOrBefore(value: string | null | undefined, decisionMs: number): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= decisionMs;
}

function validateOptionalDecisionTimeEvidence(packet: LiveGateEvidencePacket, decisionAt: string): string[] {
  const blockers: string[] = [];
  const decisionMs = Date.parse(decisionAt);
  if (!Number.isFinite(decisionMs)) return ["JEV_DECISION_TIME_INVALID"];

  if (packet.responseMetrics) {
    if (packet.responseMetrics.provenance !== "LIVE_RUNTIME_EXACT") blockers.push("JEV_RESPONSE_METRICS_PROVENANCE_INVALID");
    if (!timestampAtOrBefore(packet.responseMetrics.observedAt, decisionMs)) blockers.push("JEV_RESPONSE_METRICS_LOOKAHEAD_OR_INVALID");
  }

  if (packet.capitalLiquidityEvidence) {
    const evidence = packet.capitalLiquidityEvidence;
    if (evidence.provenance !== "LIVE_RUNTIME_EXACT" || evidence.observationalOnly !== true || evidence.thresholdAuthority !== "NONE") {
      blockers.push("JEV_CAPITAL_LIQUIDITY_PROVENANCE_INVALID");
    }
    if (!timestampAtOrBefore(evidence.occurredAt, decisionMs)) blockers.push("JEV_CAPITAL_LIQUIDITY_LOOKAHEAD_OR_INVALID");
  }

  if (packet.policyDiagnostics) {
    if (packet.policyDiagnostics.provenance !== "LIVE_RUNTIME_EXACT") blockers.push("JEV_POLICY_DIAGNOSTICS_PROVENANCE_INVALID");
    if (!timestampAtOrBefore(packet.policyDiagnostics.observedAt, decisionMs)) blockers.push("JEV_POLICY_DIAGNOSTICS_LOOKAHEAD_OR_INVALID");
  }

  if (packet.ppdSupport) {
    const ppd = packet.ppdSupport;
    if (
      ppd.provenance !== "LIVE_RUNTIME_EXACT"
      || ppd.supportingOnly !== true
      || ppd.standaloneTrigger !== false
    ) blockers.push("JEV_PPD_PROVENANCE_OR_AUTHORITY_INVALID");
    if (!timestampAtOrBefore(ppd.observedAt, decisionMs)) blockers.push("JEV_PPD_LOOKAHEAD_OR_INVALID");
    for (const window of ppd.windows) {
      if (!timestampAtOrBefore(window.to, decisionMs)) blockers.push(`JEV_PPD_WINDOW_TO_LOOKAHEAD_OR_INVALID:${window.windowMinutes}`);
      if (window.from && !timestampAtOrBefore(window.from, decisionMs)) blockers.push(`JEV_PPD_WINDOW_FROM_LOOKAHEAD_OR_INVALID:${window.windowMinutes}`);
    }
  }

  return blockers;
}

function jevEvidencePacket(packet: LiveGateEvidencePacket) {
  const capital = packet.capitalLiquidityEvidence
    ? (({ receivedAt: _receivedAt, ...decisionTimeEvidence }) => decisionTimeEvidence)(packet.capitalLiquidityEvidence)
    : undefined;
  return {
    identity: packet.identity,
    gates: packet.gates,
    responseMetrics: packet.responseMetrics,
    capitalLiquidityEvidence: capital,
    policyDiagnostics: packet.policyDiagnostics,
    ppdSupport: packet.ppdSupport,
  };
}

function exactCandidateKey(candidate: ExecutionCandidateInput): string {
  return `${candidate.symbol}:${candidate.side}:${candidate.strike}:${candidate.expiryDate}:DTE${candidate.dte}:${candidate.moneyness}`;
}

function sameCandidate(a: ExecutionCandidateInput, b: ExecutionCandidateInput): boolean {
  return a.symbol === b.symbol
    && a.side === b.side
    && a.strike === b.strike
    && a.expiryDate === b.expiryDate
    && a.dte === b.dte
    && a.moneyness === b.moneyness
    && a.premiumLtp === b.premiumLtp
    && a.capitalFit === b.capitalFit
    && a.liquidityOk === b.liquidityOk
    && a.spreadOk === b.spreadOk
    && a.premiumResponseConfirmed === b.premiumResponseConfirmed
    && a.deltaGammaResponseConfirmed === b.deltaGammaResponseConfirmed
    && a.thetaIvBurdenAcceptable === b.thetaIvBurdenAcceptable
    && a.multiExpiryConflictAbsent === b.multiExpiryConflictAbsent
    && a.currentOrNearExpiryUsable === b.currentOrNearExpiryUsable
    && a.higherDteUsable === b.higherDteUsable
    && (a.fallbackDteApproved ?? null) === (b.fallbackDteApproved ?? null);
}

/**
 * Rebuilds the candidate from the exact live gate packet at that packet's own
 * decision-time anchor. This allows persisted exact packets to be replayed
 * without judging their freshness against today's wall clock and without
 * reconstructing missing historical selector gates.
 */
export function buildJevDecisionShadowSampleFromLivePacket(
  sampleId: string,
  packet: LiveGateEvidencePacket,
): JevDecisionShadowSampleBuildResult {
  const blockers: string[] = [];
  if (!validSampleId(sampleId)) blockers.push("JEV_SAMPLE_ID_INVALID");

  const decisionAt = packet?.identity?.observedAt;
  if (!decisionAt || !Number.isFinite(Date.parse(decisionAt))) {
    blockers.push("JEV_DECISION_TIME_INVALID");
    return { sample: null, blockers };
  }

  blockers.push(...validateOptionalDecisionTimeEvidence(packet, decisionAt));
  if (blockers.length > 0) return { sample: null, blockers };

  const assembled = assembleLiveExecutionCandidateInput(packet, decisionAt);
  if (!assembled.ready || !assembled.candidate) {
    blockers.push(...assembled.blockers.map((x) => `JEV_EXACT_GATE_PACKET_BLOCKED:${x}`));
    return { sample: null, blockers };
  }

  const baselineSelector = selectExecutionCandidate(assembled.candidate);
  return {
    sample: blockers.length === 0 ? {
      sampleId,
      candidate: assembled.candidate,
      evidencePacket: packet,
      baselineSelector,
    } : null,
    blockers,
  };
}

function validateSample(sample: JevDecisionShadowSample, seen: Set<string>): string[] {
  const blockers: string[] = [];
  const id = sample.sampleId?.trim();
  if (!validSampleId(id)) blockers.push("JEV_SAMPLE_ID_INVALID");
  else if (seen.has(id)) blockers.push(`JEV_DUPLICATE_SAMPLE_ID:${id}`);
  else seen.add(id);

  const decisionAt = sample.evidencePacket?.identity?.observedAt;
  if (!decisionAt || !Number.isFinite(Date.parse(decisionAt))) {
    blockers.push(`JEV_DECISION_TIME_INVALID:${id || "UNKNOWN"}`);
  } else {
    blockers.push(...validateOptionalDecisionTimeEvidence(sample.evidencePacket, decisionAt).map((x) => `${x}:${id || "UNKNOWN"}`));
    const assembled = assembleLiveExecutionCandidateInput(sample.evidencePacket, decisionAt);
    if (!assembled.ready || !assembled.candidate) {
      blockers.push(...assembled.blockers.map((x) => `JEV_EXACT_GATE_PACKET_BLOCKED:${id || "UNKNOWN"}:${x}`));
    } else if (!sameCandidate(assembled.candidate, sample.candidate)) {
      blockers.push(`JEV_CANDIDATE_NOT_EXACT_PACKET_DERIVED:${id || "UNKNOWN"}`);
    }
  }

  if (sample.evidencePacket?.identity?.provenance !== "LIVE_RUNTIME_EXACT") {
    blockers.push(`JEV_EXACT_LIVE_PROVENANCE_REQUIRED:${id || "UNKNOWN"}`);
  }
  if (sample.evidencePacket?.identity?.symbol !== sample.candidate?.symbol) {
    blockers.push(`JEV_SYMBOL_MISMATCH:${id || "UNKNOWN"}`);
  }
  if (sample.baselineSelector?.version !== "EXECUTION_CANDIDATE_SELECTOR_V2") {
    blockers.push(`JEV_BASELINE_SELECTOR_VERSION_INVALID:${id || "UNKNOWN"}`);
  } else {
    const expectedSelector = selectExecutionCandidate(sample.candidate);
    if (
      sample.baselineSelector.decision !== expectedSelector.decision
      || sample.baselineSelector.candidateKey !== expectedSelector.candidateKey
      || JSON.stringify(sample.baselineSelector.reasonCodes) !== JSON.stringify(expectedSelector.reasonCodes)
    ) {
      blockers.push(`JEV_BASELINE_SELECTOR_NOT_EXACT_REEVALUATION:${id || "UNKNOWN"}`);
    }
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
    decisionTimestamp: sample.evidencePacket.identity.observedAt,
    candidate: sample.candidate,
    evidencePacket: jevEvidencePacket(sample.evidencePacket),
    constraints: {
      optionBuyerOnly: true,
      exactLiveGatePacketOnly: true,
      useOnlySuppliedDecisionTimeEvidence: true,
      doNotInferMissingMarketData: true,
      futureOutcomeHidden: true,
      baselineSelectorHiddenFromJev: true,
      decisionIsResearchShadowOnly: true,
    },
  });
}

function questionsFor(sampleId: string): Record<string, JevShadowQuestion> {
  return {
    [`${sampleId}__action`]: {
      type: "choice",
      instructions: `For record "${sampleId}", decide whether the exact supplied option-buying candidate should be TAKEN or rejected as NO_TRADE using only the supplied decision-time evidence. Do not invent missing data and do not use future outcomes.`,
      criteria: {
        TAKE_CANDIDATE: "The exact candidate is sufficiently supported by coherent, fresh, non-conflicting evidence and its supplied option-buying constraints.",
        NO_TRADE: "The exact candidate is not sufficiently supported because evidence is stale, missing, conflicting, weak, or the supplied option-buying constraints are not satisfied.",
      },
    },
    [`${sampleId}__evidence_consistent`]: {
      type: "noul",
      instructions: `For record "${sampleId}", is the supplied decision-time evidence internally consistent for this exact candidate?`,
      criteria: {
        true: "The supplied evidence is materially coherent and mutually supportive.",
        false: "The supplied evidence is materially contradictory, incomplete, stale, or insufficient.",
      },
    },
    [`${sampleId}__material_conflict`]: {
      type: "noul",
      instructions: `For record "${sampleId}", is there a material conflict that should stop an option buyer from taking this exact candidate?`,
      criteria: {
        true: "At least one material conflict or missing requirement should block the candidate.",
        false: "No material conflict or missing requirement is evident in the supplied evidence.",
      },
    },
    [`${sampleId}__quality`]: {
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
    sourcePolicy: "PERSISTED_OR_LIVE_H1_EXACT_GATE_PACKET_ONLY",
    request: {
      model: JEV_PINNED_MODEL,
      state: {
        description: "OptionPilot exact live gate packet evidence captured at decision time. Each record is independent. Baseline selector decisions and future outcomes are intentionally hidden from Jev.",
        records,
      },
      questions,
    },
    baseline: safeSamples.map((sample) => ({
      sampleId: sample.sampleId,
      decisionTimestamp: sample.evidencePacket.identity.observedAt,
      symbol: sample.candidate.symbol,
      side: sample.candidate.side,
      strike: sample.candidate.strike,
      expiryDate: sample.candidate.expiryDate,
      dte: sample.candidate.dte,
      moneyness: sample.candidate.moneyness,
      premiumLtp: sample.candidate.premiumLtp,
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
