export type H1ForwardCandidateDecision = "SELECT" | "BLOCK";
export type H1ForwardCandidateSide = "CE" | "PE";

export interface H1ForwardCandidateDecisionInput {
  symbol: string;
  expiry: string;
  strike: number;
  side: H1ForwardCandidateSide;
  decision: H1ForwardCandidateDecision;
  reasonCodes: string[];
  gates?: Record<string, boolean | null>;
  selectorVersion?: string | null;
}

export interface H1ForwardCandidateBindingResult {
  version: "H1_FORWARD_CANDIDATE_DECISION_BINDING_V1";
  candidateKeys: ReadonlySet<string>;
  accepted: H1ForwardCandidateDecisionInput[];
  rejected: { index: number; reason: string }[];
  failClosed: true;
  semantics: "EXPLICIT_SELECTOR_DECISIONS_ONLY_NO_INFERENCE";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function keyOf(x: H1ForwardCandidateDecisionInput): string {
  return `${x.symbol}|${x.expiry}|${x.strike}|${x.side}`;
}

export function bindH1ForwardCandidateDecisions(input: unknown): H1ForwardCandidateBindingResult {
  const candidateKeys = new Set<string>();
  const accepted: H1ForwardCandidateDecisionInput[] = [];
  const rejected: { index: number; reason: string }[] = [];

  // Backward-compatible absence means no explicit selector evidence was supplied.
  // It must never be interpreted as either SELECT or BLOCK.
  if (input == null) {
    return {
      version: "H1_FORWARD_CANDIDATE_DECISION_BINDING_V1",
      candidateKeys,
      accepted,
      rejected,
      failClosed: true,
      semantics: "EXPLICIT_SELECTOR_DECISIONS_ONLY_NO_INFERENCE",
    };
  }

  if (!Array.isArray(input)) {
    return {
      version: "H1_FORWARD_CANDIDATE_DECISION_BINDING_V1",
      candidateKeys,
      accepted,
      rejected: [{ index: -1, reason: "CANDIDATE_DECISIONS_NOT_ARRAY" }],
      failClosed: true,
      semantics: "EXPLICIT_SELECTOR_DECISIONS_ONLY_NO_INFERENCE",
    };
  }

  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      rejected.push({ index, reason: "INVALID_DECISION_OBJECT" });
      return;
    }
    const r = raw as Record<string, unknown>;
    const symbol = text(r.symbol)?.toUpperCase() ?? null;
    const expiry = text(r.expiry);
    const side = text(r.side)?.toUpperCase() ?? null;
    const strike = typeof r.strike === "number" && Number.isFinite(r.strike) ? r.strike : null;
    const decision = text(r.decision)?.toUpperCase() ?? null;
    const reasonCodes = Array.isArray(r.reasonCodes)
      ? r.reasonCodes.map(text).filter((x): x is string => !!x)
      : [];

    if (!symbol || !expiry || !validDateOnly(expiry) || strike == null || strike <= 0 || (side !== "CE" && side !== "PE") || (decision !== "SELECT" && decision !== "BLOCK")) {
      rejected.push({ index, reason: "INVALID_SELECTOR_DECISION_IDENTITY" });
      return;
    }

    const normalized: H1ForwardCandidateDecisionInput = {
      symbol,
      expiry,
      strike,
      side,
      decision,
      reasonCodes,
      gates: r.gates && typeof r.gates === "object" && !Array.isArray(r.gates)
        ? r.gates as Record<string, boolean | null>
        : undefined,
      selectorVersion: text(r.selectorVersion),
    };

    accepted.push(normalized);
    if (normalized.decision === "SELECT") candidateKeys.add(keyOf(normalized));
  });

  return {
    version: "H1_FORWARD_CANDIDATE_DECISION_BINDING_V1",
    candidateKeys,
    accepted,
    rejected,
    failClosed: true,
    semantics: "EXPLICIT_SELECTOR_DECISIONS_ONLY_NO_INFERENCE",
  };
}
