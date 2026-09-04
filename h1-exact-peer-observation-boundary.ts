import type { H1ExactPeerDirectionalState, H1ExactPeerObservation } from "./h1-exact-multi-expiry-peer-resolver.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1ExactPeerObservationInput {
  instrumentToken: number;
  dte: number;
  observedAt: string;
  directionalState: H1ExactPeerDirectionalState;
  provenance: "LIVE_RUNTIME_EXACT";
}

export interface H1ExactPeerObservationBoundaryResult {
  version: "H1_EXACT_PEER_OBSERVATION_BOUNDARY_V1";
  accepted: boolean;
  observation: H1ExactPeerObservation | null;
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  infersDirectionalState: false;
  failClosed: true;
}

function validTime(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDirectionalState(value: unknown): value is H1ExactPeerDirectionalState {
  return value === "SUPPORTS" || value === "CONFLICTS" || value === "NEUTRAL";
}

export function acceptH1ExactPeerObservation(
  input: H1ExactPeerObservationInput,
  registryEntries: KiteImmediateTokenEntry[],
): H1ExactPeerObservationBoundaryResult {
  const blockers: string[] = [];

  if (input?.provenance !== "LIVE_RUNTIME_EXACT") blockers.push("NON_EXACT_PEER_PROVENANCE");
  if (!Number.isInteger(input?.instrumentToken) || input.instrumentToken <= 0) blockers.push("INVALID_PEER_TOKEN");
  if (!Number.isInteger(input?.dte) || input.dte < 0) blockers.push("INVALID_PEER_DTE");
  if (!validTime(input?.observedAt)) blockers.push("INVALID_PEER_TIMESTAMP");
  if (!validDirectionalState(input?.directionalState)) blockers.push("INVALID_PEER_DIRECTIONAL_STATE");
  if (!Array.isArray(registryEntries) || registryEntries.length === 0) blockers.push("MISSING_CANONICAL_REGISTRY");

  const matches = Array.isArray(registryEntries)
    ? registryEntries.filter((entry) => entry.instrumentToken === input?.instrumentToken)
    : [];
  if (matches.length !== 1) blockers.push(matches.length === 0 ? "PEER_TOKEN_NOT_IN_REGISTRY" : "AMBIGUOUS_PEER_TOKEN");

  const entry = matches[0];
  if (entry && (entry.role !== "OPTION" || !entry.expiry || !Number.isFinite(entry.strike) ||
      (entry.optionSide !== "CE" && entry.optionSide !== "PE"))) {
    blockers.push("PEER_OPTION_IDENTITY_UNVERIFIED");
  }

  if (blockers.length > 0) return result(false, null, blockers);

  return result(true, {
    instrumentToken: input.instrumentToken,
    dte: input.dte,
    observedAt: input.observedAt,
    directionalState: input.directionalState,
  }, []);
}

function result(
  accepted: boolean,
  observation: H1ExactPeerObservation | null,
  blockers: string[],
): H1ExactPeerObservationBoundaryResult {
  return {
    version: "H1_EXACT_PEER_OBSERVATION_BOUNDARY_V1",
    accepted,
    observation,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    infersDirectionalState: false,
    failClosed: true,
  };
}
