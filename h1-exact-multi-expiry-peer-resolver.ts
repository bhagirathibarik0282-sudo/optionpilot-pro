import type { MultiExpiryPeerSnapshot } from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export type H1ExactPeerDirectionalState = "SUPPORTS" | "CONFLICTS" | "NEUTRAL";

export interface H1ExactPeerObservation {
  instrumentToken: number;
  dte: number;
  observedAt: string;
  directionalState: H1ExactPeerDirectionalState;
}

export interface H1ExactMultiExpiryPeerResolverPolicy {
  maxObservationAgeMs: number;
  requiredPeerCount: number;
}

export interface H1ExactMultiExpiryPeerResolverResult {
  version: "H1_EXACT_MULTI_EXPIRY_PEER_RESOLVER_V1";
  ready: boolean;
  peers: MultiExpiryPeerSnapshot[];
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function validTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validPolicy(policy: H1ExactMultiExpiryPeerResolverPolicy): boolean {
  return Number.isFinite(policy?.maxObservationAgeMs) && policy.maxObservationAgeMs > 0 &&
    Number.isInteger(policy?.requiredPeerCount) && policy.requiredPeerCount >= 1;
}

function supportedSymbol(symbol: string): symbol is MultiExpiryPeerSnapshot["symbol"] {
  return symbol === "NIFTY" || symbol === "SENSEX" || symbol === "BANKNIFTY";
}

function optionIdentity(entry: KiteImmediateTokenEntry | undefined): entry is KiteImmediateTokenEntry & {
  role: "OPTION";
  expiry: string;
  strike: number;
  optionSide: "CE" | "PE";
} {
  return !!entry && entry.role === "OPTION" && !!entry.expiry &&
    Number.isFinite(entry.strike) && Number(entry.strike) > 0 &&
    (entry.optionSide === "CE" || entry.optionSide === "PE") && supportedSymbol(entry.symbol);
}

export function resolveH1ExactMultiExpiryPeers(
  targetInstrumentToken: number,
  registryEntries: KiteImmediateTokenEntry[],
  observations: H1ExactPeerObservation[],
  nowIso: string,
  policy: H1ExactMultiExpiryPeerResolverPolicy,
): H1ExactMultiExpiryPeerResolverResult {
  const blockers: string[] = [];
  const peers: MultiExpiryPeerSnapshot[] = [];
  const nowMs = validTime(nowIso);

  if (!validPolicy(policy)) blockers.push("INVALID_PEER_RESOLVER_POLICY");
  if (nowMs == null) blockers.push("INVALID_NOW_TIMESTAMP");
  if (!Array.isArray(registryEntries) || registryEntries.length === 0) blockers.push("MISSING_CANONICAL_REGISTRY");
  if (!Array.isArray(observations)) blockers.push("INVALID_PEER_OBSERVATIONS");

  const byToken = new Map<number, KiteImmediateTokenEntry>();
  if (Array.isArray(registryEntries)) {
    for (const entry of registryEntries) {
      if (!Number.isInteger(entry?.instrumentToken) || entry.instrumentToken <= 0 || byToken.has(entry.instrumentToken)) {
        blockers.push("INVALID_OR_DUPLICATE_REGISTRY_TOKEN");
        continue;
      }
      byToken.set(entry.instrumentToken, entry);
    }
  }

  const target = byToken.get(targetInstrumentToken);
  if (!optionIdentity(target)) blockers.push("TARGET_OPTION_IDENTITY_UNVERIFIED");

  if (blockers.length > 0 || !target || !optionIdentity(target) || nowMs == null || !validPolicy(policy)) {
    return result(false, [], blockers);
  }

  const peerByExpiry = new Map<string, MultiExpiryPeerSnapshot>();
  for (const observation of observations) {
    if (!Number.isInteger(observation?.instrumentToken) || observation.instrumentToken <= 0) {
      blockers.push("INVALID_PEER_TOKEN");
      continue;
    }
    const entry = byToken.get(observation.instrumentToken);
    if (!optionIdentity(entry)) {
      blockers.push("PEER_OPTION_IDENTITY_UNVERIFIED");
      continue;
    }

    if (entry.symbol !== target.symbol || entry.optionSide !== target.optionSide || entry.expiry === target.expiry) {
      blockers.push("PEER_IDENTITY_MISMATCH");
      continue;
    }

    const observedMs = validTime(observation.observedAt);
    if (observedMs == null) {
      blockers.push("INVALID_PEER_TIMESTAMP");
      continue;
    }
    const age = nowMs - observedMs;
    if (age < 0) {
      blockers.push("FUTURE_PEER_EVIDENCE");
      continue;
    }
    if (age > policy.maxObservationAgeMs) {
      blockers.push("STALE_PEER_EVIDENCE");
      continue;
    }
    if (!Number.isInteger(observation.dte) || observation.dte < 0) {
      blockers.push("INVALID_PEER_DTE");
      continue;
    }
    if (observation.directionalState !== "SUPPORTS" && observation.directionalState !== "CONFLICTS" && observation.directionalState !== "NEUTRAL") {
      blockers.push("INVALID_PEER_DIRECTIONAL_STATE");
      continue;
    }
    if (peerByExpiry.has(entry.expiry)) {
      blockers.push("AMBIGUOUS_DUPLICATE_PEER_EXPIRY");
      continue;
    }

    peerByExpiry.set(entry.expiry, {
      source: "LIVE_RUNTIME_EXACT",
      symbol: entry.symbol,
      side: entry.optionSide,
      expiryDate: entry.expiry,
      dte: observation.dte,
      observedAt: observation.observedAt,
      directionalState: observation.directionalState,
    });
  }

  peers.push(...[...peerByExpiry.values()].sort((a, b) => a.dte - b.dte || a.expiryDate.localeCompare(b.expiryDate)));
  if (peers.length < policy.requiredPeerCount) blockers.push("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS");

  return result(blockers.length === 0, blockers.length === 0 ? peers : [], blockers);
}

function result(
  ready: boolean,
  peers: MultiExpiryPeerSnapshot[],
  blockers: string[],
): H1ExactMultiExpiryPeerResolverResult {
  return {
    version: "H1_EXACT_MULTI_EXPIRY_PEER_RESOLVER_V1",
    ready,
    peers,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
