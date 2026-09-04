import { createKiteH1ExactDualPathCore } from "./kite-h1-exact-dual-path-core.js";
import { KiteH1ExactShadowSupervisor } from "./kite-h1-exact-shadow-supervisor.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import type { H1KiteGreekModelPolicy } from "./h1-kite-exact-price-greek-adapter.js";
import type { LivePremiumDeltaGammaPolicy } from "./h1-live-premium-delta-gamma-evaluator.js";
import type { ThetaIvMultiExpiryPolicy } from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import type { LiveCapitalLiquidityDtePolicy } from "./h1-live-capital-liquidity-dte-gates.js";
import { H1ExactPeerRuntimeStore } from "./h1-exact-peer-runtime-store.js";
import type { H1ExpectedPremiumDirection } from "./h1-exact-peer-directional-state-classifier.js";
import { H1ExactLiveSpotDirectionStore } from "./h1-exact-live-spot-direction-store.js";
import type { H1ExactLiveSpotDirectionPolicy } from "./h1-exact-live-spot-direction-provider.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface H1ExactShadowContractPolicy {
  instrumentToken: number;
  moneyness: "ATM" | "ITM1";
  orderQuantity: number;
}

export interface H1ExactShadowDirectionPolicy extends H1ExactLiveSpotDirectionPolicy {
  maxDirectionAgeMs: number;
}

export interface H1ExactShadowPolicy {
  contracts: H1ExactShadowContractPolicy[];
  directionPolicy: H1ExactShadowDirectionPolicy;
  greekPolicy: H1KiteGreekModelPolicy;
  premiumPolicy: LivePremiumDeltaGammaPolicy;
  burdenPolicy: ThetaIvMultiExpiryPolicy;
  capitalLiquidityDtePolicy: LiveCapitalLiquidityDtePolicy;
}

export interface H1ExactShadowLiveConfig {
  enabled: boolean;
  apiKey: string | null;
  registryEntries: KiteImmediateTokenEntry[];
  policy: H1ExactShadowPolicy | null;
}

export type H1ExactShadowLiveReason =
  | "DISABLED"
  | "DUPLICATE_SHADOW_RUNTIME_FORBIDDEN"
  | "API_KEY_MISSING"
  | "AUTHORITY_UNAVAILABLE"
  | "STARTED";

function parseJson(raw: string, code: string): unknown {
  try { return JSON.parse(raw); } catch { throw new Error(code); }
}

function finite(value: unknown, minimum = 0): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function validTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validatePolicy(raw: unknown): H1ExactShadowPolicy {
  if (!raw || typeof raw !== "object") throw new Error("KITE_H1_EXACT_POLICY_INVALID");
  const p = raw as H1ExactShadowPolicy;
  if (!Array.isArray(p.contracts) || p.contracts.length === 0) throw new Error("KITE_H1_EXACT_CONTRACT_POLICY_REQUIRED");
  const tokens = new Set<number>();
  for (const row of p.contracts) {
    if (!Number.isInteger(row.instrumentToken) || row.instrumentToken <= 0 ||
        (row.moneyness !== "ATM" && row.moneyness !== "ITM1") ||
        !Number.isInteger(row.orderQuantity) || row.orderQuantity <= 0 ||
        tokens.has(row.instrumentToken)) {
      throw new Error("KITE_H1_EXACT_CONTRACT_POLICY_INVALID");
    }
    if ((row as any).expectedPremiumDirection != null) throw new Error("KITE_H1_EXACT_STATIC_CONTRACT_DIRECTION_FORBIDDEN");
    tokens.add(row.instrumentToken);
  }
  if (!finite(p.directionPolicy?.maxObservationGapMs, 1) ||
      !finite(p.directionPolicy?.minAbsoluteSpotMovePct) ||
      !finite(p.directionPolicy?.maxDirectionAgeMs, 1)) {
    throw new Error("KITE_H1_EXACT_DIRECTION_POLICY_INVALID");
  }
  if (!finite(p.greekPolicy?.annualRiskFreeRate) || !finite(p.greekPolicy?.annualDividendYield) ||
      !finite(p.greekPolicy?.maxAgeMs, 1) || !finite(p.greekPolicy?.maxUnderlyingSkewMs, 1)) {
    throw new Error("KITE_H1_EXACT_GREEK_POLICY_INVALID");
  }
  if (!finite(p.premiumPolicy?.maxObservationGapMs, 1) ||
      !finite(p.premiumPolicy?.minPremiumMovePct) ||
      !finite(p.premiumPolicy?.minAbsoluteDeltaChange) ||
      !finite(p.premiumPolicy?.minCurrentGamma)) {
    throw new Error("KITE_H1_EXACT_PREMIUM_POLICY_INVALID");
  }
  if (!finite(p.burdenPolicy?.maxObservationAgeMs, 1) ||
      !finite(p.burdenPolicy?.maxAbsThetaPctOfPremium) ||
      !finite(p.burdenPolicy?.minIv) || !finite(p.burdenPolicy?.maxIv) ||
      !Number.isInteger(p.burdenPolicy?.requiredPeerCount) || p.burdenPolicy.requiredPeerCount < 1 ||
      !Number.isInteger(p.burdenPolicy?.maxConflictingPeerCount) || p.burdenPolicy.maxConflictingPeerCount < 0) {
    throw new Error("KITE_H1_EXACT_BURDEN_POLICY_INVALID");
  }
  if (!finite(p.capitalLiquidityDtePolicy?.maxCapitalPerTrade, 1) ||
      !finite(p.capitalLiquidityDtePolicy?.maxRelativeSpreadPct) ||
      !finite(p.capitalLiquidityDtePolicy?.minBidDepthCoverageMultiple) ||
      !finite(p.capitalLiquidityDtePolicy?.minAskDepthCoverageMultiple) ||
      typeof p.capitalLiquidityDtePolicy?.allowFallbackDte5To7 !== "boolean") {
    throw new Error("KITE_H1_EXACT_LIQUIDITY_POLICY_INVALID");
  }
  return p;
}

function validateExactPeerCapacity(registryEntries: KiteImmediateTokenEntry[], policy: H1ExactShadowPolicy): void {
  const byToken = new Map(registryEntries.map((entry) => [entry.instrumentToken, entry]));
  const configured = policy.contracts.map((row) => {
    const entry = byToken.get(row.instrumentToken);
    if (!entry) throw new Error("KITE_H1_EXACT_CONTRACT_NOT_IN_REGISTRY");
    if (entry.role !== "OPTION" || !entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0 ||
        (entry.optionSide !== "CE" && entry.optionSide !== "PE")) {
      throw new Error("KITE_H1_EXACT_CONTRACT_OPTION_IDENTITY_REQUIRED");
    }
    return entry as KiteImmediateTokenEntry & { role: "OPTION"; expiry: string; strike: number; optionSide: "CE" | "PE" };
  });

  for (const target of configured) {
    const peerExpiries = new Set(
      configured
        .filter((peer) => peer.instrumentToken !== target.instrumentToken &&
          peer.symbol === target.symbol && peer.optionSide === target.optionSide && peer.expiry !== target.expiry)
        .map((peer) => peer.expiry),
    );
    if (peerExpiries.size < policy.burdenPolicy.requiredPeerCount) {
      throw new Error("KITE_H1_EXACT_INSUFFICIENT_CONFIGURED_PEER_EXPIRIES");
    }
  }
}

export function readH1ExactShadowLiveConfig(env: NodeJS.ProcessEnv = process.env): H1ExactShadowLiveConfig {
  const enabled = env.KITE_H1_EXACT_SHADOW_ENABLED === "true";
  const apiKey = env.KITE_API_KEY?.trim() || null;
  if (!enabled) return { enabled: false, apiKey, registryEntries: [], policy: null };
  if (env.KITE_RUNTIME_SHADOW_ENABLED === "true") throw new Error("DUPLICATE_SHADOW_RUNTIME_FORBIDDEN");

  const registryRaw = env.KITE_SHADOW_REGISTRY_JSON?.trim();
  const policyRaw = env.KITE_H1_EXACT_POLICY_JSON?.trim();
  if (!registryRaw) throw new Error("KITE_SHADOW_REGISTRY_JSON_REQUIRED");
  if (!policyRaw) throw new Error("KITE_H1_EXACT_POLICY_JSON_REQUIRED");
  const registryEntries = parseJson(registryRaw, "KITE_SHADOW_REGISTRY_JSON_INVALID");
  if (!Array.isArray(registryEntries) || registryEntries.length === 0) throw new Error("KITE_SHADOW_REGISTRY_JSON_EMPTY");
  const policy = validatePolicy(parseJson(policyRaw, "KITE_H1_EXACT_POLICY_JSON_INVALID"));
  validateExactPeerCapacity(registryEntries as KiteImmediateTokenEntry[], policy);
  return { enabled: true, apiKey, registryEntries: registryEntries as KiteImmediateTokenEntry[], policy };
}

export async function startH1ExactShadowLiveService(env: NodeJS.ProcessEnv = process.env) {
  let cfg: H1ExactShadowLiveConfig;
  try {
    cfg = readH1ExactShadowLiveConfig(env);
  } catch (error) {
    const reason = error instanceof Error && error.message === "DUPLICATE_SHADOW_RUNTIME_FORBIDDEN"
      ? "DUPLICATE_SHADOW_RUNTIME_FORBIDDEN" : "DISABLED";
    return status(false, false, reason, 0);
  }
  if (!cfg.enabled) return status(false, false, "DISABLED", 0);
  if (!cfg.apiKey) return status(true, false, "API_KEY_MISSING", 0);

  const authority = await resolveKiteAuthoritySession();
  if (!authority.session) return status(true, false, "AUTHORITY_UNAVAILABLE", 0);

  const registry = new KiteImmediateTokenRegistry(cfg.registryEntries);
  const policy = cfg.policy!;
  const contractPolicy = new Map(policy.contracts.map((x) => [x.instrumentToken, x]));
  const directionStore = new H1ExactLiveSpotDirectionStore({
    registry,
    policy: {
      maxObservationGapMs: policy.directionPolicy.maxObservationGapMs,
      minAbsoluteSpotMovePct: policy.directionPolicy.minAbsoluteSpotMovePct,
    },
    maxUnderlyingAgeMs: policy.greekPolicy.maxAgeMs,
  });
  let currentRuntimeNowIso: string | null = null;

  const liveDirectionFor = (symbol: RecorderSymbol) => {
    const direction = directionStore.directionFor(symbol);
    const nowMs = validTime(currentRuntimeNowIso);
    const observedMs = validTime(direction?.currentObservedAt);
    if (!direction?.ready || !direction.direction || nowMs == null || observedMs == null ||
        nowMs < observedMs || nowMs - observedMs > policy.directionPolicy.maxDirectionAgeMs) return null;
    return direction.direction;
  };

  const peerStore = new H1ExactPeerRuntimeStore({
    registryEntries: registry.entries(),
    classifierPolicy: {
      maxObservationGapMs: policy.premiumPolicy.maxObservationGapMs,
      minAbsolutePremiumMovePct: policy.premiumPolicy.minPremiumMovePct,
    },
    maxObservationAgeMs: policy.burdenPolicy.maxObservationAgeMs,
    requiredPeerCount: policy.burdenPolicy.requiredPeerCount,
    expectedDirectionFor: (entry) => {
      const direction = liveDirectionFor(entry.symbol);
      if (!direction || (entry.optionSide !== "CE" && entry.optionSide !== "PE")) {
        throw new Error("VERIFIED_LIVE_DIRECTION_UNAVAILABLE");
      }
      const optionShouldRise = (direction === "UP" && entry.optionSide === "CE") ||
        (direction === "DOWN" && entry.optionSide === "PE");
      return (optionShouldRise ? "UP" : "DOWN") as H1ExpectedPremiumDirection;
    },
  });

  const rawRuntime = createKiteH1ExactDualPathCore({
    registry,
    cluster: { windowMs: 2_000, minDistinctMetrics: 2 },
    maxTickAgeMs: 5_000,
    trendFor: (symbol) => {
      const direction = liveDirectionFor(symbol);
      if (!direction) return { side: "NONE", valid: false };
      return { side: direction === "UP" ? "CE" : "PE", valid: true };
    },
  }, {
    registry,
    greekPolicy: policy.greekPolicy,
    orderQuantityFor: (entry) => contractPolicy.get(entry.instrumentToken)?.orderQuantity ?? 0,
    publisherFor: (entry, previous, current) => {
      const row = contractPolicy.get(entry.instrumentToken);
      if (!row) throw new Error("CONTRACT_POLICY_MISSING");
      const peerResult = peerStore.ingestAndResolve(entry.instrumentToken, previous, current, current.observedAt ?? "");
      return {
        moneyness: row.moneyness,
        multiExpiryPeers: peerResult.ready ? peerResult.resolver!.peers : [],
        premiumPolicy: policy.premiumPolicy,
        burdenPolicy: policy.burdenPolicy,
        capitalLiquidityDtePolicy: policy.capitalLiquidityDtePolicy,
      };
    },
  });

  const runtime = {
    ingestPacket: async (packet: Parameters<typeof rawRuntime.ingestPacket>[0], receivedAt: string, nowIso: string = receivedAt) => {
      currentRuntimeNowIso = nowIso;
      const entry = registry.get(packet?.instrumentToken ?? 0);
      if (entry?.role === "SPOT") directionStore.ingest(packet, receivedAt);
      return rawRuntime.ingestPacket(packet, receivedAt, nowIso);
    },
  };

  const supervisor = new KiteH1ExactShadowSupervisor({
    enabled: true, apiKey: cfg.apiKey, accessToken: authority.session.accessToken,
    registry, runtime, reconnectDelayMs: 1_000, reconnectMaxAttempts: 10,
  });
  supervisor.start();
  const out = status(true, true, "STARTED", registry.tokens().length);
  console.log(JSON.stringify(out));
  return { ...out, supervisor };
}

function status(enabled: boolean, started: boolean, reason: H1ExactShadowLiveReason, subscribedTokenCount: number) {
  return {
    version: "H1_EXACT_SHADOW_LIVE_SERVICE_V1" as const,
    enabled, started, reason, subscribedTokenCount,
    directionSourceStatus: "VERIFIED_RUNTIME_BOUND_FAIL_CLOSED" as const,
    multiExpiryPeerStatus: "WIRED_FAIL_CLOSED" as const,
    productionImpact: "NONE" as const,
    telegramSendAllowed: false as const,
    affectsVerdict: false as const,
    affectsExecution: false as const,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startH1ExactShadowLiveService().catch((error) => {
    console.error(JSON.stringify({
      version: "H1_EXACT_SHADOW_LIVE_SERVICE_V1", started: false,
      reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      productionImpact: "NONE", telegramSendAllowed: false,
      affectsVerdict: false, affectsExecution: false,
    }));
    process.exitCode = 2;
  });
}
