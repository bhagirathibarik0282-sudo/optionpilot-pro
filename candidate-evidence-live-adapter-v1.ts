import { buildCandidateEvidenceShadow, type CandidateEvidenceResult, type EvidenceFamilyInput } from "./candidate-evidence-shadow-v1.js";

export interface CandidateLiveMeasurementInput {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  priceDirection?: "UP" | "DOWN" | "FLAT" | null;
  futuresDirection?: "UP" | "DOWN" | "FLAT" | null;
  priceFuturesVerified?: boolean;
  ppdSide?: "CE" | "PE" | null;
  ppdValuePp?: number | null;
  premiumVerified?: boolean;
  positioningSide?: "CE" | "PE" | "NEUTRAL" | null;
  positioningVerified?: boolean;
  breadthUp?: number | null;
  breadthDown?: number | null;
  breadthVerified?: boolean;
  primaryDirection?: "UP" | "DOWN" | "FLAT" | null;
  peerDirection?: "UP" | "DOWN" | "FLAT" | null;
  multiDteVerified?: boolean;
}

function unavailable(detail: string): EvidenceFamilyInput {
  return { stance: "UNAVAILABLE", verified: false, strength: 0, detail };
}

function fromDirectionalPair(
  a: "UP" | "DOWN" | "FLAT" | null | undefined,
  b: "UP" | "DOWN" | "FLAT" | null | undefined,
  verified: boolean | undefined,
  label: string,
): EvidenceFamilyInput {
  if (!verified || !a || !b) return unavailable(`${label}: unavailable`);
  if (a === "UP" && b === "UP") return { stance: "CE", verified: true, strength: 1, detail: `${label}: both UP` };
  if (a === "DOWN" && b === "DOWN") return { stance: "PE", verified: true, strength: 1, detail: `${label}: both DOWN` };
  return { stance: "NEUTRAL", verified: true, strength: 0, detail: `${label}: mixed/flat` };
}

function premiumFamily(input: CandidateLiveMeasurementInput): EvidenceFamilyInput {
  if (!input.premiumVerified || !input.ppdSide || !Number.isFinite(Number(input.ppdValuePp))) return unavailable("premium/PPD unavailable");
  const magnitude = Math.abs(Number(input.ppdValuePp));
  const strength = Math.max(0, Math.min(1, magnitude / 5));
  return { stance: input.ppdSide, verified: true, strength, detail: `PPD ${input.ppdSide} ${magnitude.toFixed(2)}pp` };
}

function positioningFamily(input: CandidateLiveMeasurementInput): EvidenceFamilyInput {
  if (!input.positioningVerified || !input.positioningSide) return unavailable("positioning unavailable");
  if (input.positioningSide === "NEUTRAL") return { stance: "NEUTRAL", verified: true, strength: 0, detail: "positioning neutral" };
  return { stance: input.positioningSide, verified: true, strength: 1, detail: `positioning ${input.positioningSide}` };
}

function breadthFamily(input: CandidateLiveMeasurementInput): EvidenceFamilyInput {
  if (!input.breadthVerified || !Number.isFinite(Number(input.breadthUp)) || !Number.isFinite(Number(input.breadthDown))) return unavailable("breadth unavailable");
  const up = Number(input.breadthUp), down = Number(input.breadthDown), total = up + down;
  if (total <= 0 || up === down) return { stance: "NEUTRAL", verified: true, strength: 0, detail: `breadth ${up}/${down}` };
  const edge = Math.abs(up - down) / total;
  return { stance: up > down ? "CE" : "PE", verified: true, strength: edge, detail: `breadth up ${up} down ${down}` };
}

export function buildCandidateEvidenceFromLiveMeasurement(input: CandidateLiveMeasurementInput): CandidateEvidenceResult {
  const priceFutures = fromDirectionalPair(input.priceDirection, input.futuresDirection, input.priceFuturesVerified, "price/futures");
  const premiumPpd = premiumFamily(input);
  const positioning = positioningFamily(input);
  const breadthLeadLag = breadthFamily(input);
  const multiDte = fromDirectionalPair(input.primaryDirection, input.peerDirection, input.multiDteVerified, "multi-DTE");
  return buildCandidateEvidenceShadow({ symbol: input.symbol, priceFutures, premiumPpd, positioning, breadthLeadLag, multiDte });
}
