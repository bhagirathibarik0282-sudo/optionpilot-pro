export type CandidateSide = "CE" | "PE" | "NONE";
export type EvidenceStance = "CE" | "PE" | "NEUTRAL" | "UNAVAILABLE";

export interface EvidenceFamilyInput {
  stance: EvidenceStance;
  strength?: number | null;
  verified?: boolean;
  detail?: string | null;
}

export interface CandidateEvidenceInput {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  priceFutures: EvidenceFamilyInput;
  premiumPpd: EvidenceFamilyInput;
  positioning: EvidenceFamilyInput;
  breadthLeadLag: EvidenceFamilyInput;
  multiDte: EvidenceFamilyInput;
}

export interface CandidateEvidenceFamilyResult {
  family: "PRICE_FUTURES" | "PREMIUM_PPD" | "POSITIONING" | "BREADTH_LEAD_LAG" | "MULTI_DTE";
  stance: EvidenceStance;
  points: number;
  verified: boolean;
  detail: string | null;
}

export interface CandidateEvidenceResult {
  version: "CANDIDATE_EVIDENCE_SHADOW_V1";
  symbol: CandidateEvidenceInput["symbol"];
  candidate: CandidateSide;
  ceScore: number;
  peScore: number;
  leadingScore: number;
  margin: number;
  verifiedFamilyCount: number;
  families: CandidateEvidenceFamilyResult[];
  state: "NOT_READY" | "MIXED" | "CE_WATCH" | "PE_WATCH";
  shadowOnly: true;
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
}

const FAMILY_CAP = 20;

function clampStrength(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 1;
  return Math.max(0, Math.min(1, Number(value)));
}

function familyResult(
  family: CandidateEvidenceFamilyResult["family"],
  input: EvidenceFamilyInput,
): CandidateEvidenceFamilyResult {
  const verified = input.verified === true && input.stance !== "UNAVAILABLE";
  const directional = input.stance === "CE" || input.stance === "PE";
  const points = verified && directional ? Math.round(FAMILY_CAP * clampStrength(input.strength)) : 0;
  return {
    family,
    stance: verified ? input.stance : "UNAVAILABLE",
    points,
    verified,
    detail: input.detail ? String(input.detail).slice(0, 180) : null,
  };
}

export function buildCandidateEvidenceShadow(input: CandidateEvidenceInput): CandidateEvidenceResult {
  const families = [
    familyResult("PRICE_FUTURES", input.priceFutures),
    familyResult("PREMIUM_PPD", input.premiumPpd),
    familyResult("POSITIONING", input.positioning),
    familyResult("BREADTH_LEAD_LAG", input.breadthLeadLag),
    familyResult("MULTI_DTE", input.multiDte),
  ];

  const ceScore = families.filter((x) => x.stance === "CE").reduce((sum, x) => sum + x.points, 0);
  const peScore = families.filter((x) => x.stance === "PE").reduce((sum, x) => sum + x.points, 0);
  const verifiedFamilyCount = families.filter((x) => x.verified).length;
  const leadingScore = Math.max(ceScore, peScore);
  const margin = Math.abs(ceScore - peScore);

  let candidate: CandidateSide = "NONE";
  let state: CandidateEvidenceResult["state"] = "NOT_READY";

  // Shadow ranking only: require breadth of evidence and a clear margin.
  if (verifiedFamilyCount >= 3) {
    if (leadingScore < 40 || margin < 15) {
      state = "MIXED";
    } else if (ceScore > peScore) {
      candidate = "CE";
      state = "CE_WATCH";
    } else if (peScore > ceScore) {
      candidate = "PE";
      state = "PE_WATCH";
    }
  }

  return {
    version: "CANDIDATE_EVIDENCE_SHADOW_V1",
    symbol: input.symbol,
    candidate,
    ceScore,
    peScore,
    leadingScore,
    margin,
    verifiedFamilyCount,
    families,
    state,
    shadowOnly: true,
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
  };
}
