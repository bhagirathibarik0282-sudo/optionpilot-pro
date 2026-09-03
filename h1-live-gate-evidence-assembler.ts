import type { ExecutionCandidateInput } from "./execution-candidate-selector.js";

export const H1_LIVE_GATE_EVIDENCE_ASSEMBLER_VERSION = "H1_LIVE_GATE_EVIDENCE_ASSEMBLER_V1" as const;

export type LiveGateName =
  | "capitalFit"
  | "liquidityOk"
  | "spreadOk"
  | "premiumResponseConfirmed"
  | "deltaGammaResponseConfirmed"
  | "thetaIvBurdenAcceptable"
  | "multiExpiryConflictAbsent"
  | "currentOrNearExpiryUsable"
  | "higherDteUsable"
  | "fallbackDteApproved";

export interface LiveBooleanGateEvidence {
  value: boolean;
  observedAt: string;
  source: string;
  provenance: "LIVE_RUNTIME_EXACT";
}

export interface LiveCandidateIdentityEvidence {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: "CE" | "PE";
  strike: number;
  expiryDate: string;
  dte: number;
  moneyness: "ATM" | "ITM1";
  premiumLtp: number;
  observedAt: string;
  source: string;
  provenance: "LIVE_RUNTIME_EXACT";
}

export interface LiveGateEvidencePacket {
  identity: LiveCandidateIdentityEvidence;
  gates: Partial<Record<LiveGateName, LiveBooleanGateEvidence>>;
}

export interface LiveGateEvidenceAssemblerResult {
  version: typeof H1_LIVE_GATE_EVIDENCE_ASSEMBLER_VERSION;
  ready: boolean;
  candidate: ExecutionCandidateInput | null;
  blockers: string[];
  gateAudit: Record<LiveGateName, { present: boolean; fresh: boolean; source: string | null; observedAt: string | null }>;
  failClosed: true;
  semantics: "LIVE_EXACT_GATE_EVIDENCE_ONLY_NO_DEFAULTS_NO_INFERENCE";
}

const BASE_REQUIRED_GATES: LiveGateName[] = [
  "capitalFit",
  "liquidityOk",
  "spreadOk",
  "premiumResponseConfirmed",
  "deltaGammaResponseConfirmed",
  "thetaIvBurdenAcceptable",
  "multiExpiryConflictAbsent",
];

function validIso(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function validIdentity(x: LiveCandidateIdentityEvidence): boolean {
  return (x.symbol === "NIFTY" || x.symbol === "SENSEX" || x.symbol === "BANKNIFTY") &&
    (x.side === "CE" || x.side === "PE") &&
    Number.isFinite(x.strike) && x.strike > 0 &&
    validDateOnly(x.expiryDate) &&
    Number.isInteger(x.dte) && x.dte >= 0 &&
    (x.moneyness === "ATM" || x.moneyness === "ITM1") &&
    Number.isFinite(x.premiumLtp) && x.premiumLtp > 0 &&
    x.provenance === "LIVE_RUNTIME_EXACT" &&
    typeof x.source === "string" && x.source.trim().length > 0 &&
    validIso(x.observedAt) !== null;
}

function requiredGates(identity: LiveCandidateIdentityEvidence): LiveGateName[] {
  const out = [...BASE_REQUIRED_GATES];
  if (identity.symbol === "BANKNIFTY") out.push("higherDteUsable");
  else {
    out.push("currentOrNearExpiryUsable");
    if (identity.dte >= 5 && identity.dte <= 7) out.push("fallbackDteApproved");
  }
  return out;
}

export function assembleLiveExecutionCandidateInput(
  packet: LiveGateEvidencePacket,
  nowIso: string,
  maxAgeMs = 90_000,
): LiveGateEvidenceAssemblerResult {
  const blockers: string[] = [];
  const nowMs = validIso(nowIso);
  if (nowMs === null) blockers.push("INVALID_ASSEMBLER_NOW");
  if (!packet || typeof packet !== "object" || !packet.identity || !validIdentity(packet.identity)) {
    blockers.push("INVALID_LIVE_CANDIDATE_IDENTITY");
  }

  const identity = packet?.identity;
  const required = identity && validIdentity(identity) ? requiredGates(identity) : BASE_REQUIRED_GATES;
  const gateAudit = {} as LiveGateEvidenceAssemblerResult["gateAudit"];

  const allGateNames: LiveGateName[] = [
    "capitalFit", "liquidityOk", "spreadOk", "premiumResponseConfirmed",
    "deltaGammaResponseConfirmed", "thetaIvBurdenAcceptable", "multiExpiryConflictAbsent",
    "currentOrNearExpiryUsable", "higherDteUsable", "fallbackDteApproved",
  ];

  for (const gate of allGateNames) {
    const evidence = packet?.gates?.[gate];
    const observedMs = evidence ? validIso(evidence.observedAt) : null;
    const provenanceOk = evidence?.provenance === "LIVE_RUNTIME_EXACT";
    const sourceOk = typeof evidence?.source === "string" && evidence.source.trim().length > 0;
    const age = nowMs !== null && observedMs !== null ? nowMs - observedMs : Number.POSITIVE_INFINITY;
    const fresh = !!evidence && provenanceOk && sourceOk && observedMs !== null && age >= 0 && age <= maxAgeMs;
    gateAudit[gate] = {
      present: !!evidence,
      fresh,
      source: evidence?.source?.trim() || null,
      observedAt: evidence?.observedAt ?? null,
    };
    if (required.includes(gate)) {
      if (!evidence) blockers.push(`MISSING_GATE_${gate}`);
      else if (!provenanceOk) blockers.push(`INVALID_PROVENANCE_${gate}`);
      else if (!sourceOk) blockers.push(`MISSING_SOURCE_${gate}`);
      else if (!fresh) blockers.push(`STALE_OR_INVALID_TIMESTAMP_${gate}`);
    }
  }

  if (identity && validIdentity(identity) && nowMs !== null) {
    const identityMs = validIso(identity.observedAt)!;
    const identityAge = nowMs - identityMs;
    if (identityAge < 0 || identityAge > maxAgeMs) blockers.push("STALE_LIVE_CANDIDATE_IDENTITY");
  }

  if (blockers.length > 0 || !identity || !validIdentity(identity)) {
    return {
      version: H1_LIVE_GATE_EVIDENCE_ASSEMBLER_VERSION,
      ready: false,
      candidate: null,
      blockers,
      gateAudit,
      failClosed: true,
      semantics: "LIVE_EXACT_GATE_EVIDENCE_ONLY_NO_DEFAULTS_NO_INFERENCE",
    };
  }

  const gate = (name: LiveGateName): boolean => packet.gates[name]!.value;
  const candidate: ExecutionCandidateInput = {
    symbol: identity.symbol,
    side: identity.side,
    strike: identity.strike,
    expiryDate: identity.expiryDate,
    dte: identity.dte,
    moneyness: identity.moneyness,
    premiumLtp: identity.premiumLtp,
    capitalFit: gate("capitalFit"),
    liquidityOk: gate("liquidityOk"),
    spreadOk: gate("spreadOk"),
    premiumResponseConfirmed: gate("premiumResponseConfirmed"),
    deltaGammaResponseConfirmed: gate("deltaGammaResponseConfirmed"),
    thetaIvBurdenAcceptable: gate("thetaIvBurdenAcceptable"),
    multiExpiryConflictAbsent: gate("multiExpiryConflictAbsent"),
    currentOrNearExpiryUsable: identity.symbol === "BANKNIFTY" ? false : gate("currentOrNearExpiryUsable"),
    higherDteUsable: identity.symbol === "BANKNIFTY" ? gate("higherDteUsable") : false,
    fallbackDteApproved: identity.symbol !== "BANKNIFTY" && identity.dte >= 5 && identity.dte <= 7
      ? gate("fallbackDteApproved")
      : undefined,
  };

  return {
    version: H1_LIVE_GATE_EVIDENCE_ASSEMBLER_VERSION,
    ready: true,
    candidate,
    blockers: [],
    gateAudit,
    failClosed: true,
    semantics: "LIVE_EXACT_GATE_EVIDENCE_ONLY_NO_DEFAULTS_NO_INFERENCE",
  };
}
