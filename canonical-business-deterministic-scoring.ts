import { buildBusinessHorizonView, type BusinessHorizon, type BusinessHorizonInput, type BusinessHorizonView } from "./business-buyer-seller-layer.js";
import type { CanonicalBusinessEvidenceInputAdapterResult } from "./canonical-business-evidence-input-adapter.js";
import type { CanonicalMarketFamily } from "./canonical-one-roof-market-snapshot.js";

export const CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1 = "CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1" as const;

const REQUIRED_FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

const HORIZON_WEIGHTS: Record<BusinessHorizon, Record<CanonicalMarketFamily, number>> = {
  INTRADAY: {
    MARKET_STRUCTURE: 15,
    FUTURES_CONFIRMATION: 12,
    OPTION_PREMIUMS: 15,
    OI_POSITIONING: 10,
    MULTI_DTE: 5,
    VOLATILITY: 8,
    HEAVYWEIGHTS: 10,
    SECTOR_BREADTH: 8,
    RESPONSE_LADDER: 10,
    LIQUIDITY_EXECUTABILITY: 7,
  },
  MULTIDAY: {
    MARKET_STRUCTURE: 12,
    FUTURES_CONFIRMATION: 10,
    OPTION_PREMIUMS: 8,
    OI_POSITIONING: 13,
    MULTI_DTE: 15,
    VOLATILITY: 10,
    HEAVYWEIGHTS: 10,
    SECTOR_BREADTH: 10,
    RESPONSE_LADDER: 7,
    LIQUIDITY_EXECUTABILITY: 5,
  },
  EXPIRY: {
    MARKET_STRUCTURE: 10,
    FUTURES_CONFIRMATION: 8,
    OPTION_PREMIUMS: 18,
    OI_POSITIONING: 16,
    MULTI_DTE: 7,
    VOLATILITY: 12,
    HEAVYWEIGHTS: 6,
    SECTOR_BREADTH: 5,
    RESPONSE_LADDER: 8,
    LIQUIDITY_EXECUTABILITY: 10,
  },
};

export interface CanonicalNormalizedBusinessFamilyEvidence {
  family: CanonicalMarketFamily;
  buyerSupport: number;
  sellerSupport: number;
  deterministic: true;
  evidenceReady: true;
  sourceId: string;
  sourceManifestHash: string;
  devilFlags: string[];
}

export interface CanonicalBusinessDeterministicScoringInput {
  businessEvidence: CanonicalBusinessEvidenceInputAdapterResult;
  normalizedEvidence: CanonicalNormalizedBusinessFamilyEvidence[];
}

export interface CanonicalBusinessScoredHorizon {
  horizon: BusinessHorizon;
  buyerScore: number;
  sellerScore: number;
  buyerContributionByFamily: Record<CanonicalMarketFamily, number>;
  sellerContributionByFamily: Record<CanonicalMarketFamily, number>;
  view: BusinessHorizonView;
}

export interface CanonicalBusinessDeterministicScoringResult {
  version: typeof CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1;
  ready: boolean;
  sourceManifestHash: string | null;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" | null;
  businessUse: "BUYER_ELIGIBLE" | "OBSERVATION_ONLY_MONTHLY" | null;
  horizons: CanonicalBusinessScoredHorizon[];
  blockers: string[];
  deterministic: true;
  normalizedEvidenceRequired: true;
  rawPayloadHeuristicsUsed: false;
  aiMayOverride: false;
  candidateSelected: false;
  telegramSent: false;
  createsOrders: false;
  affectsExecution: false;
  wiredIntoServer: false;
  failClosed: true;
}

function finiteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fail(blockers: string[]): CanonicalBusinessDeterministicScoringResult {
  return {
    version: CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1,
    ready: false,
    sourceManifestHash: null,
    symbol: null,
    businessUse: null,
    horizons: [],
    blockers: [...new Set(blockers)],
    deterministic: true,
    normalizedEvidenceRequired: true,
    rawPayloadHeuristicsUsed: false,
    aiMayOverride: false,
    candidateSelected: false,
    telegramSent: false,
    createsOrders: false,
    affectsExecution: false,
    wiredIntoServer: false,
    failClosed: true,
  };
}

/**
 * Pure scoring contract. It never guesses directional support from opaque snapshot payloads.
 * Every canonical family must first provide an explicit deterministic 0..100 buyer/seller support
 * value tied to the exact source-manifest hash. The weighted result is presentation-only and is
 * delegated to the existing buyer/seller view logic for WAIT/edge/star rendering.
 */
export function scoreCanonicalBusinessEvidence(
  input: CanonicalBusinessDeterministicScoringInput,
): CanonicalBusinessDeterministicScoringResult {
  const businessEvidence = input?.businessEvidence;
  if (
    !businessEvidence?.ready
    || !businessEvidence.sourceManifestHash
    || !businessEvidence.symbol
    || businessEvidence.readOnly !== true
    || businessEvidence.presentationInputOnly !== true
    || businessEvidence.scoresComputed !== false
    || businessEvidence.candidateSelected !== false
    || businessEvidence.telegramSent !== false
    || businessEvidence.createsOrders !== false
    || businessEvidence.affectsExecution !== false
    || businessEvidence.aiMayOverride !== false
    || businessEvidence.failClosed !== true
  ) {
    return fail(["CANONICAL_BUSINESS_SCORING_EVIDENCE_BOUNDARY_INVALID"]);
  }

  if (
    businessEvidence.blockedFamilies.length > 0
    || businessEvidence.verifiedFamilies.length !== REQUIRED_FAMILIES.length
    || REQUIRED_FAMILIES.some((family) => !businessEvidence.verifiedFamilies.includes(family))
    || businessEvidence.horizons.length !== 3
    || businessEvidence.horizons.some((h) => h.evidenceReady !== true || (h.devilFlags ?? []).length > 0)
  ) {
    return fail(["CANONICAL_BUSINESS_SCORING_VERIFIED_EVIDENCE_REQUIRED"]);
  }

  const rows = Array.isArray(input.normalizedEvidence) ? input.normalizedEvidence : [];
  const blockers: string[] = [];
  for (const family of REQUIRED_FAMILIES) {
    const matches = rows.filter((row) => row?.family === family);
    if (matches.length !== 1) {
      blockers.push(`${family}:${matches.length === 0 ? "NORMALIZED_EVIDENCE_MISSING" : "NORMALIZED_EVIDENCE_DUPLICATE"}`);
      continue;
    }
    const row = matches[0];
    if (
      row.deterministic !== true
      || row.evidenceReady !== true
      || !finiteScore(row.buyerSupport)
      || !finiteScore(row.sellerSupport)
      || typeof row.sourceId !== "string"
      || !row.sourceId.trim()
      || row.sourceManifestHash !== businessEvidence.sourceManifestHash
      || !Array.isArray(row.devilFlags)
      || row.devilFlags.length > 0
    ) {
      blockers.push(`${family}:NORMALIZED_EVIDENCE_INVALID`);
    }
  }
  if (rows.length !== REQUIRED_FAMILIES.length) blockers.push("NORMALIZED_EVIDENCE_FAMILY_COUNT_MISMATCH");
  if (blockers.length > 0) return fail(blockers);

  const byFamily = new Map(rows.map((row) => [row.family, row]));
  const horizons = businessEvidence.horizons.map((base): CanonicalBusinessScoredHorizon => {
    const weights = HORIZON_WEIGHTS[base.horizon];
    const buyerContributionByFamily = {} as Record<CanonicalMarketFamily, number>;
    const sellerContributionByFamily = {} as Record<CanonicalMarketFamily, number>;
    let buyerScore = 0;
    let sellerScore = 0;

    for (const family of REQUIRED_FAMILIES) {
      const row = byFamily.get(family)!;
      const buyerContribution = row.buyerSupport * weights[family] / 100;
      const sellerContribution = row.sellerSupport * weights[family] / 100;
      buyerContributionByFamily[family] = round2(buyerContribution);
      sellerContributionByFamily[family] = round2(sellerContribution);
      buyerScore += buyerContribution;
      sellerScore += sellerContribution;
    }

    const scoredInput: BusinessHorizonInput = {
      ...base,
      buyerScore: round2(buyerScore),
      sellerScore: round2(sellerScore),
      evidenceReady: true,
      devilFlags: [],
      reasons: [
        ...(base.reasons ?? []),
        `scoring:${CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1}`,
        "normalizedFamilies:10/10",
      ],
    };

    return {
      horizon: base.horizon,
      buyerScore: scoredInput.buyerScore!,
      sellerScore: scoredInput.sellerScore!,
      buyerContributionByFamily,
      sellerContributionByFamily,
      view: buildBusinessHorizonView(scoredInput),
    };
  });

  return {
    version: CANONICAL_BUSINESS_DETERMINISTIC_SCORING_V1,
    ready: true,
    sourceManifestHash: businessEvidence.sourceManifestHash,
    symbol: businessEvidence.symbol,
    businessUse: businessEvidence.symbol === "BANKNIFTY" ? "OBSERVATION_ONLY_MONTHLY" : "BUYER_ELIGIBLE",
    horizons,
    blockers: [],
    deterministic: true,
    normalizedEvidenceRequired: true,
    rawPayloadHeuristicsUsed: false,
    aiMayOverride: false,
    candidateSelected: false,
    telegramSent: false,
    createsOrders: false,
    affectsExecution: false,
    wiredIntoServer: false,
    failClosed: true,
  };
}
