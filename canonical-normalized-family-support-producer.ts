import type { CanonicalBusinessEvidenceInputAdapterResult } from "./canonical-business-evidence-input-adapter.js";
import type { CanonicalNormalizedBusinessFamilyEvidence } from "./canonical-business-deterministic-scoring.js";
import type { CanonicalMarketFamily } from "./canonical-one-roof-market-snapshot.js";

export const CANONICAL_NORMALIZED_FAMILY_SUPPORT_PRODUCER_V1 = "CANONICAL_NORMALIZED_FAMILY_SUPPORT_PRODUCER_V1" as const;

const REQUIRED_FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE",
  "VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];

export type CanonicalFamilyStance = "BUYER_SUPPORT" | "SELLER_SUPPORT" | "BALANCED";

export interface CanonicalDeterministicFamilySignal {
  family: CanonicalMarketFamily;
  stance: CanonicalFamilyStance;
  strength: number; // 0..100, explicit deterministic strength from the family engine.
  deterministic: true;
  evidenceReady: true;
  sourceId: string;
  sourceManifestHash: string;
  devilFlags: string[];
}

export interface CanonicalNormalizedFamilySupportResult {
  version: typeof CANONICAL_NORMALIZED_FAMILY_SUPPORT_PRODUCER_V1;
  ready: boolean;
  sourceManifestHash: string | null;
  normalizedEvidence: CanonicalNormalizedBusinessFamilyEvidence[];
  blockers: string[];
  deterministic: true;
  rawPayloadHeuristicsUsed: false;
  aiMayOverride: false;
  candidateSelected: false;
  telegramSent: false;
  createsOrders: false;
  affectsExecution: false;
  wiredIntoServer: false;
  failClosed: true;
}

function fail(blockers: string[]): CanonicalNormalizedFamilySupportResult {
  return {
    version: CANONICAL_NORMALIZED_FAMILY_SUPPORT_PRODUCER_V1,
    ready: false,
    sourceManifestHash: null,
    normalizedEvidence: [],
    blockers: [...new Set(blockers)],
    deterministic: true,
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

function validStrength(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function supportFor(signal: CanonicalDeterministicFamilySignal): [number, number] {
  if (signal.stance === "BALANCED") return [50, 50];
  const half = signal.strength / 2;
  return signal.stance === "BUYER_SUPPORT" ? [50 + half, 50 - half] : [50 - half, 50 + half];
}

/**
 * Converts explicit deterministic family-engine stance/strength into the normalized 0..100
 * buyer/seller support contract consumed by canonical business scoring. It never inspects opaque
 * raw payloads and never infers stance from prices, labels, AI text, or Telegram state.
 */
export function produceCanonicalNormalizedFamilySupport(input: {
  businessEvidence: CanonicalBusinessEvidenceInputAdapterResult;
  familySignals: CanonicalDeterministicFamilySignal[];
}): CanonicalNormalizedFamilySupportResult {
  const evidence = input?.businessEvidence;
  if (
    !evidence?.ready || !evidence.sourceManifestHash || !evidence.symbol
    || evidence.readOnly !== true || evidence.presentationInputOnly !== true
    || evidence.scoresComputed !== false || evidence.candidateSelected !== false
    || evidence.telegramSent !== false || evidence.createsOrders !== false
    || evidence.affectsExecution !== false || evidence.aiMayOverride !== false || evidence.failClosed !== true
    || evidence.blockedFamilies.length > 0
    || evidence.verifiedFamilies.length !== REQUIRED_FAMILIES.length
    || REQUIRED_FAMILIES.some((family) => !evidence.verifiedFamilies.includes(family))
  ) return fail(["CANONICAL_NORMALIZED_SUPPORT_EVIDENCE_BOUNDARY_INVALID"]);

  const signals = Array.isArray(input.familySignals) ? input.familySignals : [];
  const blockers: string[] = [];
  const normalizedEvidence: CanonicalNormalizedBusinessFamilyEvidence[] = [];

  for (const family of REQUIRED_FAMILIES) {
    const matches = signals.filter((signal) => signal?.family === family);
    if (matches.length !== 1) {
      blockers.push(`${family}:${matches.length === 0 ? "FAMILY_SIGNAL_MISSING" : "FAMILY_SIGNAL_DUPLICATE"}`);
      continue;
    }
    const signal = matches[0];
    if (
      signal.deterministic !== true || signal.evidenceReady !== true
      || !["BUYER_SUPPORT","SELLER_SUPPORT","BALANCED"].includes(signal.stance)
      || !validStrength(signal.strength)
      || typeof signal.sourceId !== "string" || !signal.sourceId.trim()
      || signal.sourceManifestHash !== evidence.sourceManifestHash
      || !Array.isArray(signal.devilFlags) || signal.devilFlags.length > 0
    ) {
      blockers.push(`${family}:FAMILY_SIGNAL_INVALID`);
      continue;
    }
    const [buyerSupport, sellerSupport] = supportFor(signal);
    normalizedEvidence.push({
      family,
      buyerSupport,
      sellerSupport,
      deterministic: true,
      evidenceReady: true,
      sourceId: signal.sourceId,
      sourceManifestHash: signal.sourceManifestHash,
      devilFlags: [],
    });
  }

  if (signals.length !== REQUIRED_FAMILIES.length) blockers.push("FAMILY_SIGNAL_COUNT_MISMATCH");
  if (blockers.length > 0) return fail(blockers);

  return {
    version: CANONICAL_NORMALIZED_FAMILY_SUPPORT_PRODUCER_V1,
    ready: true,
    sourceManifestHash: evidence.sourceManifestHash,
    normalizedEvidence,
    blockers: [],
    deterministic: true,
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
