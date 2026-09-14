import type { CanonicalLiveFamilySignalEnvelope } from "./canonical-live-family-signal-registry.js";
import type { CanonicalMarketFamily, CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";

export const H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1 = "H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1" as const;

export type H1RemainingDirectionalFamily =
  | "MARKET_STRUCTURE"
  | "FUTURES_CONFIRMATION"
  | "OI_POSITIONING"
  | "VOLATILITY"
  | "HEAVYWEIGHTS"
  | "SECTOR_BREADTH"
  | "RESPONSE_LADDER";

export interface H1ExactDirectionalFamilyEvidence {
  provenance: "LIVE_RUNTIME_EXACT_DIRECTIONAL_FAMILY_V1";
  family: H1RemainingDirectionalFamily;
  symbol: CanonicalMarketSymbol;
  direction: "UP" | "DOWN";
  strength: number;
  observedAtMs: number;
  sourceId: string;
  sourceManifestHash: string;
  deterministic: true;
  evidenceReady: true;
  grantsDirectionalSupport: true;
  contextOnly: false;
  devilFlags: string[];
}

export interface H1RemainingFamilyDirectionalAttestorResult {
  version: typeof H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1;
  ready: boolean;
  envelopes: CanonicalLiveFamilySignalEnvelope[];
  blockers: string[];
  requiredFamilyCount: 7;
  verifiedFamilyCount: number;
  contextOnlyEvidencePromoted: false;
  optionSideDirectionInferred: false;
  scoresComputed: false;
  candidateSelected: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const REQUIRED: readonly H1RemainingDirectionalFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OI_POSITIONING",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
] as const;

function base(blockers: string[], verifiedFamilyCount = 0): H1RemainingFamilyDirectionalAttestorResult {
  return {
    version: H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1,
    ready: false,
    envelopes: [],
    blockers: [...new Set(blockers)],
    requiredFamilyCount: 7,
    verifiedFamilyCount,
    contextOnlyEvidencePromoted: false,
    optionSideDirectionInferred: false,
    scoresComputed: false,
    candidateSelected: false,
    sendsTelegram: false,
    createsOrders: false,
    affectsExecution: false,
    failClosed: true,
  };
}

function validDirectionSource(source: H1ExactLiveSpotDirectionResult): boolean {
  return Boolean(
    source
    && source.ready === true
    && (source.direction === "UP" || source.direction === "DOWN")
    && source.source === "VERIFIED_DETERMINISTIC_RUNTIME"
    && source.sourceId === "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1"
    && source.liveRuntimeExact === true
    && source.deterministic === true
    && Array.isArray(source.blockers)
    && source.blockers.length === 0
    && source.failClosed === true
  );
}

/**
 * Strict bridge for the seven families not covered by the exact H1 option-gate adapter.
 * Legacy context/shadow evidence cannot pass this boundary. Each upstream producer must
 * explicitly grant same-direction deterministic support and supply its own 0..100 strength.
 */
export function attestH1RemainingDirectionalFamilies(input: {
  symbol: CanonicalMarketSymbol;
  selectedOptionSide: "CE" | "PE";
  directionSource: H1ExactLiveSpotDirectionResult;
  evidence: H1ExactDirectionalFamilyEvidence[];
  sourceManifestHash: string;
  nowMs: number;
  maxAgeMs?: number;
}): H1RemainingFamilyDirectionalAttestorResult {
  const blockers: string[] = [];
  const maxAgeMs = input?.maxAgeMs ?? 90_000;
  const manifest = input?.sourceManifestHash;

  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(input?.symbol)) blockers.push("INVALID_SYMBOL");
  if (input?.selectedOptionSide !== "CE" && input?.selectedOptionSide !== "PE") blockers.push("INVALID_SELECTED_OPTION_SIDE");
  if (typeof manifest !== "string" || !manifest.trim()) blockers.push("INVALID_SOURCE_MANIFEST");
  if (!Number.isFinite(input?.nowMs) || input.nowMs <= 0 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    blockers.push("INVALID_TIME_POLICY");
  }
  if (!validDirectionSource(input?.directionSource)) blockers.push("VERIFIED_EXACT_DIRECTION_SOURCE_REQUIRED");

  const direction = validDirectionSource(input?.directionSource) ? input.directionSource.direction! : null;
  if (direction && ((direction === "UP" && input.selectedOptionSide !== "CE") || (direction === "DOWN" && input.selectedOptionSide !== "PE"))) {
    blockers.push("SELECTED_OPTION_SIDE_CONFLICTS_WITH_INDEPENDENT_DIRECTION_SOURCE");
  }

  const rows = Array.isArray(input?.evidence) ? input.evidence : [];
  const accepted: H1ExactDirectionalFamilyEvidence[] = [];

  for (const family of REQUIRED) {
    const matches = rows.filter((row) => row?.family === family);
    if (matches.length !== 1) {
      blockers.push(`${family}:${matches.length === 0 ? "EVIDENCE_MISSING" : "EVIDENCE_DUPLICATE"}`);
      continue;
    }
    const row = matches[0];
    const ageMs = input.nowMs - row.observedAtMs;
    const valid = row.provenance === "LIVE_RUNTIME_EXACT_DIRECTIONAL_FAMILY_V1"
      && row.symbol === input.symbol
      && row.direction === direction
      && Number.isFinite(row.strength) && row.strength >= 0 && row.strength <= 100
      && Number.isFinite(row.observedAtMs) && row.observedAtMs > 0
      && ageMs >= 0 && ageMs <= maxAgeMs
      && typeof row.sourceId === "string" && row.sourceId.trim().length > 0
      && row.sourceManifestHash === manifest
      && row.deterministic === true
      && row.evidenceReady === true
      && row.grantsDirectionalSupport === true
      && row.contextOnly === false
      && Array.isArray(row.devilFlags) && row.devilFlags.length === 0;
    if (!valid) blockers.push(`${family}:DIRECTIONAL_EVIDENCE_NOT_ATTESTABLE`);
    else accepted.push(row);
  }

  if (rows.some((row) => !REQUIRED.includes(row?.family))) blockers.push("UNEXPECTED_DIRECTIONAL_FAMILY");
  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length > 0 || accepted.length !== REQUIRED.length) return base(uniqueBlockers, accepted.length);

  const stance = "BUYER_SUPPORT" as const;
  return {
    ...base([], 7),
    ready: true,
    envelopes: accepted.map((row) => ({
      provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
      symbol: row.symbol,
      observedAtMs: row.observedAtMs,
      signal: {
        family: row.family as CanonicalMarketFamily,
        stance,
        strength: row.strength,
        deterministic: true,
        evidenceReady: true,
        sourceId: row.sourceId,
        sourceManifestHash: row.sourceManifestHash,
        sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT",
        grantsDirectionalSupport: true,
        devilFlags: [],
      },
    })),
    blockers: [],
  };
}
