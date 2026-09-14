import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";

export const H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1 = "H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1" as const;

export type H1HeavyweightWeightAuthorityClass = "OFFICIAL_INDEX_PROVIDER_VERSIONED_REFERENCE";

export interface H1OfficialIndexConstituentWeight {
  constituentId: string;
  tradingSymbol: string;
  weightPct: number;
}

export interface H1OfficialHeavyweightWeightReference {
  authorityClass: H1HeavyweightWeightAuthorityClass;
  providerId: string;
  symbol: CanonicalMarketSymbol;
  asOfMs: number;
  receivedAtMs: number;
  sourceDocumentId: string;
  sourceVersion: string;
  sourceManifestHash: string;
  constituents: H1OfficialIndexConstituentWeight[];
}

export interface H1OfficialHeavyweightWeightAuthorityPolicy {
  expectedProviderIdBySymbol: Partial<Record<CanonicalMarketSymbol, string>>;
  maxReferenceAgeMs: number;
  minConstituentCount: number;
  minCoveragePct: number;
  maxWeightSumDeviationPct: number;
}

export interface H1OfficialHeavyweightWeightAuthorityResult {
  version: typeof H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1;
  ready: boolean;
  symbol: CanonicalMarketSymbol;
  providerId: string | null;
  asOfMs: number | null;
  receivedAtMs: number | null;
  sourceDocumentId: string | null;
  sourceVersion: string | null;
  sourceManifestHash: string | null;
  constituentCount: number;
  coveragePct: number | null;
  constituents: H1OfficialIndexConstituentWeight[];
  blockers: string[];
  grantsWeightAuthority: boolean;
  grantsDirectionalSupport: false;
  liveRuntimeExact: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  affectsVerdict: false;
  failClosed: true;
}

const VERSION = H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1;

const safety = {
  grantsDirectionalSupport: false as const,
  liveRuntimeExact: false as const,
  sendsTelegram: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  affectsVerdict: false as const,
  failClosed: true as const,
};

function uniqueBlockers(blockers: string[]): string[] {
  return [...new Set(blockers)];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPolicy(policy: H1OfficialHeavyweightWeightAuthorityPolicy | null | undefined): boolean {
  if (!policy) return false;
  if (!Number.isFinite(policy.maxReferenceAgeMs) || policy.maxReferenceAgeMs <= 0) return false;
  if (!Number.isInteger(policy.minConstituentCount) || policy.minConstituentCount <= 0) return false;
  if (!Number.isFinite(policy.minCoveragePct) || policy.minCoveragePct <= 0 || policy.minCoveragePct > 100) return false;
  if (!Number.isFinite(policy.maxWeightSumDeviationPct) || policy.maxWeightSumDeviationPct < 0 || policy.maxWeightSumDeviationPct >= 100) return false;
  return true;
}

function blocked(symbol: CanonicalMarketSymbol, blockers: string[]): H1OfficialHeavyweightWeightAuthorityResult {
  return {
    version: VERSION,
    ready: false,
    symbol,
    providerId: null,
    asOfMs: null,
    receivedAtMs: null,
    sourceDocumentId: null,
    sourceVersion: null,
    sourceManifestHash: null,
    constituentCount: 0,
    coveragePct: null,
    constituents: [],
    blockers: uniqueBlockers(blockers),
    grantsWeightAuthority: false,
    ...safety,
  };
}

/**
 * Validates only the reference-weight authority boundary.
 *
 * It does not infer weights from live prices, market cap, key-stock counts, or
 * equal-weight breadth. It also does not turn a periodic reference snapshot
 * into LIVE_RUNTIME_EXACT evidence. A separate live adapter may combine a
 * READY result with fresh constituent price observations to produce weighted
 * participation evidence.
 */
export function validateH1OfficialHeavyweightWeightReference(input: {
  symbol: CanonicalMarketSymbol;
  reference: H1OfficialHeavyweightWeightReference | null | undefined;
  policy: H1OfficialHeavyweightWeightAuthorityPolicy;
  nowMs: number;
}): H1OfficialHeavyweightWeightAuthorityResult {
  const symbol = input.symbol;
  const blockers: string[] = [];

  if (!validPolicy(input.policy)) blockers.push("INVALID_WEIGHT_AUTHORITY_POLICY");
  if (!Number.isFinite(input.nowMs) || input.nowMs <= 0) blockers.push("INVALID_NOW");
  if (blockers.length > 0) return blocked(symbol, blockers);

  const reference = input.reference;
  if (!reference) return blocked(symbol, ["OFFICIAL_WEIGHT_REFERENCE_UNAVAILABLE"]);

  const expectedProviderId = input.policy.expectedProviderIdBySymbol[symbol];
  if (!nonEmpty(expectedProviderId)) blockers.push("EXPECTED_OFFICIAL_PROVIDER_NOT_CONFIGURED");
  if (reference.authorityClass !== "OFFICIAL_INDEX_PROVIDER_VERSIONED_REFERENCE") blockers.push("WEIGHT_REFERENCE_NOT_OFFICIAL_VERSIONED_AUTHORITY");
  if (!nonEmpty(reference.providerId)) blockers.push("WEIGHT_REFERENCE_PROVIDER_ID_MISSING");
  if (nonEmpty(expectedProviderId) && reference.providerId !== expectedProviderId) blockers.push("WEIGHT_REFERENCE_PROVIDER_MISMATCH");
  if (reference.symbol !== symbol) blockers.push("WEIGHT_REFERENCE_SYMBOL_MISMATCH");
  if (!nonEmpty(reference.sourceDocumentId)) blockers.push("WEIGHT_REFERENCE_DOCUMENT_ID_MISSING");
  if (!nonEmpty(reference.sourceVersion)) blockers.push("WEIGHT_REFERENCE_VERSION_MISSING");
  if (!nonEmpty(reference.sourceManifestHash)) blockers.push("WEIGHT_REFERENCE_MANIFEST_HASH_MISSING");

  if (!Number.isFinite(reference.asOfMs) || reference.asOfMs <= 0) blockers.push("WEIGHT_REFERENCE_ASOF_INVALID");
  if (!Number.isFinite(reference.receivedAtMs) || reference.receivedAtMs <= 0) blockers.push("WEIGHT_REFERENCE_RECEIVED_AT_INVALID");
  if (Number.isFinite(reference.asOfMs) && reference.asOfMs > input.nowMs) blockers.push("WEIGHT_REFERENCE_ASOF_FUTURE");
  if (Number.isFinite(reference.receivedAtMs) && reference.receivedAtMs > input.nowMs) blockers.push("WEIGHT_REFERENCE_RECEIVED_AT_FUTURE");
  if (Number.isFinite(reference.asOfMs) && Number.isFinite(reference.receivedAtMs) && reference.receivedAtMs < reference.asOfMs) blockers.push("WEIGHT_REFERENCE_RECEIVED_BEFORE_ASOF");
  if (Number.isFinite(reference.asOfMs) && input.nowMs - reference.asOfMs > input.policy.maxReferenceAgeMs) blockers.push("WEIGHT_REFERENCE_STALE");

  const constituents = Array.isArray(reference.constituents) ? reference.constituents : [];
  if (constituents.length < input.policy.minConstituentCount) blockers.push("WEIGHT_REFERENCE_CONSTITUENT_COUNT_INSUFFICIENT");

  const ids = new Set<string>();
  const tradingSymbols = new Set<string>();
  let coveragePct = 0;
  for (const constituent of constituents) {
    if (!nonEmpty(constituent?.constituentId) || !nonEmpty(constituent?.tradingSymbol)) {
      blockers.push("WEIGHT_REFERENCE_CONSTITUENT_IDENTITY_INVALID");
      continue;
    }
    if (ids.has(constituent.constituentId) || tradingSymbols.has(constituent.tradingSymbol)) blockers.push("WEIGHT_REFERENCE_DUPLICATE_CONSTITUENT");
    ids.add(constituent.constituentId);
    tradingSymbols.add(constituent.tradingSymbol);
    if (!Number.isFinite(constituent.weightPct) || constituent.weightPct <= 0 || constituent.weightPct > 100) {
      blockers.push("WEIGHT_REFERENCE_WEIGHT_INVALID");
      continue;
    }
    coveragePct += constituent.weightPct;
  }

  if (!Number.isFinite(coveragePct) || coveragePct < input.policy.minCoveragePct) blockers.push("WEIGHT_REFERENCE_COVERAGE_INSUFFICIENT");
  if (Number.isFinite(coveragePct) && Math.abs(100 - coveragePct) > input.policy.maxWeightSumDeviationPct) blockers.push("WEIGHT_REFERENCE_TOTAL_NOT_NEAR_100");

  const ready = blockers.length === 0;
  return {
    version: VERSION,
    ready,
    symbol,
    providerId: reference.providerId || null,
    asOfMs: reference.asOfMs || null,
    receivedAtMs: reference.receivedAtMs || null,
    sourceDocumentId: reference.sourceDocumentId || null,
    sourceVersion: reference.sourceVersion || null,
    sourceManifestHash: reference.sourceManifestHash || null,
    constituentCount: constituents.length,
    coveragePct: Number.isFinite(coveragePct) ? coveragePct : null,
    constituents: ready ? constituents.map((constituent) => ({ ...constituent })) : [],
    blockers: uniqueBlockers(blockers),
    grantsWeightAuthority: ready,
    ...safety,
  };
}
