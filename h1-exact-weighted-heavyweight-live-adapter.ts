import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { KiteConstituentMinuteRecord } from "./kite-constituent-runtime-bridge-v1.js";
import {
  H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1,
  type H1OfficialHeavyweightWeightAuthorityResult,
} from "./h1-official-heavyweight-weight-authority.js";

export const H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1 = "H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1" as const;

export interface H1ExactWeightedHeavyweightLivePolicy {
  lookbackMinutes: number;
  maxLatestAgeMs: number;
  minWindowCoveragePct: number;
  minLiveWeightCoveragePct: number;
  neutralMovePct: number;
}

export interface H1ExactWeightedHeavyweightFact {
  provenance: "LIVE_RUNTIME_EXACT";
  symbol: CanonicalMarketSymbol;
  observedAtMs: number;
  sourceId: typeof H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1;
  devilFlags: string[];
  bullishWeightPct: number;
  bearishWeightPct: number;
  neutralWeightPct: number;
  liveWeightCoveragePct: number;
  liveConstituentCount: number;
  authorityConstituentCount: number;
  lookbackMinutes: number;
  referenceProviderId: string;
  referenceDocumentId: string;
  referenceVersion: string;
  referenceManifestHash: string;
  officialWeightAuthorityVerified: true;
  normalizedMissingWeightAway: false;
}

export interface H1ExactWeightedHeavyweightLiveResult {
  version: typeof H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1;
  ready: boolean;
  symbol: CanonicalMarketSymbol;
  fact: H1ExactWeightedHeavyweightFact | null;
  blockers: string[];
  liveRuntimeExact: true;
  grantsHeavyweightFact: boolean;
  grantsDirectionalSupport: false;
  normalizedMissingWeightAway: false;
  opensSocket: false;
  fetchesNetworkData: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const VERSION = H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1;
const safety = {
  liveRuntimeExact: true as const,
  grantsDirectionalSupport: false as const,
  normalizedMissingWeightAway: false as const,
  opensSocket: false as const,
  fetchesNetworkData: false as const,
  sendsTelegram: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  failClosed: true as const,
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validPolicy(policy: H1ExactWeightedHeavyweightLivePolicy | null | undefined): boolean {
  return Boolean(
    policy
    && Number.isInteger(policy.lookbackMinutes) && policy.lookbackMinutes >= 1 && policy.lookbackMinutes <= 30
    && finitePositive(policy.maxLatestAgeMs)
    && finitePositive(policy.minWindowCoveragePct) && policy.minWindowCoveragePct <= 100
    && finitePositive(policy.minLiveWeightCoveragePct) && policy.minLiveWeightCoveragePct <= 100
    && Number.isFinite(policy.neutralMovePct) && policy.neutralMovePct >= 0 && policy.neutralMovePct < 100
  );
}

function blocked(symbol: CanonicalMarketSymbol, blockers: string[]): H1ExactWeightedHeavyweightLiveResult {
  return {
    version: VERSION,
    ready: false,
    symbol,
    fact: null,
    blockers: [...new Set(blockers)],
    grantsHeavyweightFact: false,
    ...safety,
  };
}

function authorityReady(
  authority: H1OfficialHeavyweightWeightAuthorityResult | null | undefined,
  symbol: CanonicalMarketSymbol,
): authority is H1OfficialHeavyweightWeightAuthorityResult {
  return Boolean(
    authority
    && authority.version === H1_OFFICIAL_HEAVYWEIGHT_WEIGHT_AUTHORITY_V1
    && authority.ready === true
    && authority.grantsWeightAuthority === true
    && authority.symbol === symbol
    && Array.isArray(authority.blockers) && authority.blockers.length === 0
    && typeof authority.providerId === "string" && authority.providerId.trim()
    && typeof authority.sourceDocumentId === "string" && authority.sourceDocumentId.trim()
    && typeof authority.sourceVersion === "string" && authority.sourceVersion.trim()
    && typeof authority.sourceManifestHash === "string" && authority.sourceManifestHash.trim()
    && Array.isArray(authority.constituents) && authority.constituents.length > 0
  );
}

/**
 * Joins a READY official weight authority with the already-captured immutable
 * constituent minute history from the shared Kite source. It performs no network
 * I/O and never substitutes equal weighting or renormalizes away missing weight.
 */
export function deriveH1ExactWeightedHeavyweightLiveFact(input: {
  symbol: CanonicalMarketSymbol;
  authority: H1OfficialHeavyweightWeightAuthorityResult;
  registry: CanonicalConstituentTokenEntry[];
  constituentMinutes: KiteConstituentMinuteRecord[];
  policy: H1ExactWeightedHeavyweightLivePolicy;
  nowMs: number;
}): H1ExactWeightedHeavyweightLiveResult {
  const symbol = input?.symbol;
  const blockers: string[] = [];
  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(symbol)) blockers.push("INVALID_SYMBOL");
  if (!Number.isFinite(input?.nowMs) || input.nowMs <= 0) blockers.push("INVALID_NOW");
  if (!validPolicy(input?.policy)) blockers.push("INVALID_WEIGHTED_HEAVYWEIGHT_POLICY");
  if (!authorityReady(input?.authority, symbol)) blockers.push("OFFICIAL_WEIGHT_AUTHORITY_NOT_READY");
  if (blockers.length > 0) return blocked(symbol, blockers);

  const registryRows = (Array.isArray(input.registry) ? input.registry : [])
    .filter((row) => row.parentSymbol === symbol && row.role === "HEAVYWEIGHT");
  const registryBySymbol = new Map<string, CanonicalConstituentTokenEntry[]>();
  for (const row of registryRows) {
    const key = normalized(row.tradingsymbol);
    if (!key || !Number.isInteger(row.instrumentToken) || row.instrumentToken <= 0) {
      blockers.push("HEAVYWEIGHT_REGISTRY_INVALID");
      continue;
    }
    const rows = registryBySymbol.get(key) ?? [];
    rows.push(row);
    registryBySymbol.set(key, rows);
  }

  const validMinutes = (Array.isArray(input.constituentMinutes) ? input.constituentMinutes : [])
    .filter((record) => Boolean(
      record?.immutable === true
      && finitePositive(record.minuteStartMs)
      && finitePositive(record.closedAtMs)
      && record.closedAtMs >= record.minuteStartMs + 60_000
      && record.closedAtMs <= input.nowMs
      && Array.isArray(record.ticks)
    ))
    .sort((a, b) => a.minuteStartMs - b.minuteStartMs);
  if (validMinutes.length < 2) blockers.push("HEAVYWEIGHT_CLOSED_MINUTE_HISTORY_INSUFFICIENT");

  let bullishWeightPct = 0;
  let bearishWeightPct = 0;
  let neutralWeightPct = 0;
  let liveWeightCoveragePct = 0;
  let liveConstituentCount = 0;
  const latestObservedAt: number[] = [];
  const lookbackMs = input.policy.lookbackMinutes * 60_000;

  for (const constituent of input.authority.constituents) {
    const key = normalized(constituent.tradingSymbol);
    const memberships = registryBySymbol.get(key) ?? [];
    if (memberships.length !== 1) {
      blockers.push(memberships.length === 0 ? "OFFICIAL_CONSTITUENT_NOT_IN_LIVE_REGISTRY" : "LIVE_REGISTRY_CONSTITUENT_NOT_UNIQUE");
      continue;
    }
    const token = memberships[0].instrumentToken;
    const points = validMinutes.flatMap((record) => {
      const tick = record.ticks.find((row) => row.instrumentToken === token);
      if (!tick
        || !finitePositive(tick.ltp)
        || !finitePositive(tick.exchangeTimestampMs)
        || !finitePositive(tick.receivedAtMs)
        || !finitePositive(tick.processedAtMs)
        || tick.exchangeTimestampMs > tick.receivedAtMs
        || tick.receivedAtMs > tick.processedAtMs
        || tick.exchangeTimestampMs < record.minuteStartMs
        || tick.exchangeTimestampMs >= record.minuteStartMs + 60_000) return [];
      return [{ minuteStartMs: record.minuteStartMs, observedAtMs: tick.exchangeTimestampMs, price: tick.ltp }];
    });
    if (points.length < 2) continue;

    const latest = points[points.length - 1];
    const latestAgeMs = input.nowMs - latest.observedAtMs;
    if (!Number.isFinite(latestAgeMs) || latestAgeMs < 0 || latestAgeMs > input.policy.maxLatestAgeMs) continue;

    const cutoff = latest.minuteStartMs - lookbackMs;
    const windowPoints = points.filter((point) => point.minuteStartMs >= cutoff && point.minuteStartMs <= latest.minuteStartMs);
    if (windowPoints.length < 2) continue;
    const baseline = windowPoints[0];
    const coveragePct = Math.min(100, ((latest.minuteStartMs - baseline.minuteStartMs) / lookbackMs) * 100);
    if (coveragePct < input.policy.minWindowCoveragePct) continue;

    const movePct = ((latest.price - baseline.price) / baseline.price) * 100;
    if (!Number.isFinite(movePct)) continue;
    const weight = constituent.weightPct;
    liveWeightCoveragePct += weight;
    liveConstituentCount += 1;
    latestObservedAt.push(latest.observedAtMs);
    if (movePct > input.policy.neutralMovePct) bullishWeightPct += weight;
    else if (movePct < -input.policy.neutralMovePct) bearishWeightPct += weight;
    else neutralWeightPct += weight;
  }

  if (liveWeightCoveragePct < input.policy.minLiveWeightCoveragePct) blockers.push("LIVE_WEIGHT_COVERAGE_INSUFFICIENT");
  if (latestObservedAt.length === 0) blockers.push("NO_FRESH_WEIGHTED_CONSTITUENT_WINDOW");
  if (blockers.length > 0) return blocked(symbol, blockers);

  const observedAtMs = Math.min(...latestObservedAt);
  return {
    version: VERSION,
    ready: true,
    symbol,
    fact: {
      provenance: "LIVE_RUNTIME_EXACT",
      symbol,
      observedAtMs,
      sourceId: VERSION,
      devilFlags: [],
      bullishWeightPct: round(bullishWeightPct),
      bearishWeightPct: round(bearishWeightPct),
      neutralWeightPct: round(neutralWeightPct),
      liveWeightCoveragePct: round(liveWeightCoveragePct),
      liveConstituentCount,
      authorityConstituentCount: input.authority.constituentCount,
      lookbackMinutes: input.policy.lookbackMinutes,
      referenceProviderId: input.authority.providerId!,
      referenceDocumentId: input.authority.sourceDocumentId!,
      referenceVersion: input.authority.sourceVersion!,
      referenceManifestHash: input.authority.sourceManifestHash!,
      officialWeightAuthorityVerified: true,
      normalizedMissingWeightAway: false,
    },
    blockers: [],
    grantsHeavyweightFact: true,
    ...safety,
  };
}
