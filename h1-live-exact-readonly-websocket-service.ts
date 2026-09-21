import type { H1LiveExactMarketWiringReadinessResult } from "./h1-live-exact-market-wiring-readiness.js";
import { H1LiveExactRawEvidenceStore, H1_LIVE_EXACT_RAW_DEPTH_PERSIST_KIND, H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, buildH1LiveExactRawDepthRecord, buildH1LiveExactGreekTimingRecord, type H1LiveExactRawDepthRecord, type H1LiveExactGreekTimingRecord, type H1LiveExactRawEvidenceMissing, type H1LiveExactRawEvidenceRow, type H1LiveExactRawEvidenceSymbolReadiness } from "./h1-live-exact-raw-evidence-store.js";
import { dbInsert } from "./db.js";
import { buildNearestValidMonthlyPeerReadiness, type H1NearestValidMonthlyPeerReadinessRow } from "./h1-nearest-valid-monthly-peer-readiness.js";
import { buildH1ReadOnlyEvidenceConsumerBoundary } from "./h1-readonly-evidence-consumer-boundary.js";
import { deriveH1ExactLiveSpotDirection } from "./h1-exact-live-spot-direction-provider.js";
import { auditH1ExactDirectionSourceReadiness } from "./h1-exact-direction-source-readiness.js";
import type { H1ExactUnderlyingObservation } from "./h1-kite-exact-price-greek-adapter.js";
import { bindKiteOptionPacketToH1ExactSnapshot } from "./h1-kite-exact-option-snapshot-binding.js";
import { crosscheckH1KiteGreeks, buildH1KiteGreekMathCrosscheckPersistRecord, H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND, type H1KiteGreekMathCrosscheckPersistRecord } from "./h1-kite-greek-math-crosscheck.js";
import { H1_SELECTOR_SHADOW_PROFILE_V1 } from "./h1-selector-shadow-profile.js";
import { KiteWebSocketTransport, type KiteSocketFactory } from "./kite-websocket-transport.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import { CanonicalConstituentTickStore, type CanonicalConstituentTickStoreStatus } from "./canonical-constituent-tick-store.js";
import type { CanonicalConstituentTick } from "./canonical-constituent-live-component.js";
import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import { readH1SelectorCanonicalPolicySource } from "./h1-selector-canonical-policy-source.js";
import { H1KiteExactRuntimeCoordinator } from "./h1-kite-exact-runtime-coordinator.js";
import { H1ExactPeerRuntimeStore } from "./h1-exact-peer-runtime-store.js";

export interface H1LiveExactReadOnlyConsumerObservation {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  primaryExpiry: string;
  nearestPeerExpiry: string;
  ready: boolean;
  evidenceTokenCount: number;
  blockers: string[];
}

export interface H1LiveExactReadOnlyDirectionObservation {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  ready: boolean;
  direction: "UP" | "DOWN" | null;
  spotMovePct: number | null;
  sourceReady: boolean;
  sourceId: string | null;
  blockers: string[];
}

export interface H1LiveExactReadOnlyShadowInputObservation {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  ready: boolean;
  direction: "UP" | "DOWN" | null;
  evidenceTokenCount: number;
  blockers: string[];
}

export function deriveExpectedPremiumDirectionAtCapture(
  selectorDirection: "UP" | "DOWN" | null,
  optionSide: "CE" | "PE",
): "UP" | "DOWN" | null {
  if (!selectorDirection) return null;
  return (selectorDirection === "UP" && optionSide === "CE") ||
    (selectorDirection === "DOWN" && optionSide === "PE")
    ? "UP"
    : "DOWN";
}

export interface H1LiveExactReadOnlyWebSocketServiceConfig {
  readiness: H1LiveExactMarketWiringReadinessResult;
  apiKey: string;
  accessToken: string;
  socketFactory?: KiteSocketFactory;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
  constituentRegistry?: CanonicalConstituentTokenEntry[];
  selectorPolicyEnv?: NodeJS.ProcessEnv;
  rawDepthPersist?: (record: H1LiveExactRawDepthRecord) => void | Promise<void>;
  rawGreekTimingPersist?: (record: H1LiveExactGreekTimingRecord) => void | Promise<void>;
  greekMathCrosscheckPersist?: (record: H1KiteGreekMathCrosscheckPersistRecord) => void | Promise<void>;
}

export interface H1LiveExactReadOnlyWebSocketStatus {
  version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1";
  started: boolean;
  connected: boolean;
  state: "READY" | "CONNECTING" | "RECONNECTING" | "OPEN" | "CLOSED" | "ERROR";
  subscribedTokenCount: number;
  receivedPacketCount: number;
  rejectedPacketCount: number;
  lastPacketTimestamp: string | null;
  rawEvidenceReady: boolean;
  rawEvidenceExpectedTokenCount: number;
  rawEvidenceFreshTokenCount: number;
  rawEvidenceMissingTokenCount: number;
  rawEvidenceStaleTokenCount: number;
  rawEvidenceMissing: H1LiveExactRawEvidenceMissing[];
  rawEvidenceSymbolReadiness: H1LiveExactRawEvidenceSymbolReadiness[];
  nearestPeerReadiness: H1NearestValidMonthlyPeerReadinessRow[];
  readOnlyConsumerReadySymbolCount: number;
  readOnlyConsumerObservations: H1LiveExactReadOnlyConsumerObservation[];
  readOnlyDirectionReadySymbolCount: number;
  readOnlyDirectionObservations: H1LiveExactReadOnlyDirectionObservation[];
  readOnlyShadowInputReadySymbolCount: number;
  readOnlyShadowInputObservations: H1LiveExactReadOnlyShadowInputObservation[];
  selectorRuntimePolicyReady: boolean;
  selectorRuntimeAttached: boolean;
  selectorRuntimeBlockers: string[];
  greekEvidenceStatus: "NOT_CONFIGURED" | "KITE_MATH_CROSSCHECK_OBSERVING" | "KITE_MATH_CROSSCHECK_OBSERVATIONS_AVAILABLE";
  greekCrosscheckObservationCount?: number;
  greekCrosscheckFailureCount?: number;
  greekCrosscheckLastObservedAt?: string | null;
  greekCrosscheckPolicySemantics?: "SHADOW_CALIBRATION_ONLY";
  greekCrosscheckPolicyAuthority?: "NONE";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

// Market-open acceptance validates that an exact deterministic live direction source is alive;
// it must not require a discretionary/strategy-size move. A zero threshold still fails closed
// on an unchanged spot because deriveH1ExactLiveSpotDirection explicitly rejects spotMovePct === 0.
export const H1_MARKET_OPEN_DIRECTION_POLICY = { maxObservationGapMs: 180_000, minAbsoluteSpotMovePct: 0 } as const;

export class H1LiveExactReadOnlyWebSocketService {
  private transport: KiteWebSocketTransport | null = null;
  private readonly allowedTokens: Set<number>;
  private readonly constituentEvidence: CanonicalConstituentTickStore | null;
  private readonly firstSeenTokens = new Set<number>();
  private readonly rawEvidence: H1LiveExactRawEvidenceStore;
  private readonly rawDepthPersist: (record: H1LiveExactRawDepthRecord) => void | Promise<void>;
  private readonly rawGreekTimingPersist: (record: H1LiveExactGreekTimingRecord) => void | Promise<void>;
  private readonly greekMathCrosscheckPersist: (record: H1KiteGreekMathCrosscheckPersistRecord) => void | Promise<void>;
  private readonly lastPersistedDepthMinuteByToken = new Map<number, string>();
  private readonly lastPersistedGreekTimingMinuteByToken = new Map<number, string>();
  private readonly lastPersistedGreekCrosscheckMinuteByToken = new Map<number, string>();
  private readonly latestRawSpotTimingBySymbol = new Map<H1ExactUnderlyingObservation["symbol"], {
    instrumentToken: number;
    observedAt: string;
    receivedAt: string;
  }>();
  private readonly latestGreekUnderlyingBySymbol = new Map<H1ExactUnderlyingObservation["symbol"], H1ExactUnderlyingObservation>();
  private readonly directionBaselineBySymbol = new Map<H1ExactUnderlyingObservation["symbol"], H1ExactUnderlyingObservation>();
  private readonly selectorDirectionBySymbol = new Map<H1ExactUnderlyingObservation["symbol"], "UP" | "DOWN">();
  private selectorCoordinator: H1KiteExactRuntimeCoordinator | null = null;
  private selectorPeerStore: H1ExactPeerRuntimeStore | null = null;
  private value: H1LiveExactReadOnlyWebSocketStatus;

  constructor(private readonly config: H1LiveExactReadOnlyWebSocketServiceConfig) {
    if (!config.readiness?.ready || !config.readiness.registry || config.readiness.instrumentTokens.length === 0) throw new Error("H1_LIVE_EXACT_READINESS_REQUIRED");
    if (config.readiness.mode !== "full" || config.readiness.startsSocket !== false || config.readiness.affectsVerdict !== false || config.readiness.affectsExecution !== false || config.readiness.affectsTelegram !== false) throw new Error("H1_LIVE_EXACT_READINESS_SAFETY_CONTRACT_INVALID");
    if (!config.apiKey?.trim() || !config.accessToken?.trim()) throw new Error("KITE_H1_READONLY_CREDENTIALS_REQUIRED");
    const registryTokens = config.readiness.registry.tokens();
    if (registryTokens.length !== config.readiness.instrumentTokens.length || registryTokens.some((token) => !config.readiness.instrumentTokens.includes(token))) throw new Error("H1_LIVE_EXACT_READINESS_TOKEN_MISMATCH");
    const constituentEntries = config.constituentRegistry ?? [];
    const constituentTokens = constituentEntries.map((entry) => entry.instrumentToken);
    if (constituentTokens.some((token) => registryTokens.includes(token))) {
      throw new Error("H1_LIVE_EXACT_CONSTITUENT_TOKEN_OVERLAP");
    }
    this.constituentEvidence = constituentEntries.length > 0
      ? new CanonicalConstituentTickStore(constituentEntries)
      : null;
    this.allowedTokens = new Set([...registryTokens, ...constituentTokens]);
    this.rawEvidence = new H1LiveExactRawEvidenceStore(config.readiness.registry);
    this.rawDepthPersist = config.rawDepthPersist ?? ((record) => dbInsert(H1_LIVE_EXACT_RAW_DEPTH_PERSIST_KIND, record));
    this.rawGreekTimingPersist = config.rawGreekTimingPersist ?? ((record) => dbInsert(H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, record));
    this.greekMathCrosscheckPersist = config.greekMathCrosscheckPersist ?? ((record) => dbInsert(H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND, record));
    this.value = {
      version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1", started: false, connected: false, state: "READY",
      subscribedTokenCount: this.allowedTokens.size, receivedPacketCount: 0, rejectedPacketCount: 0, lastPacketTimestamp: null,
      rawEvidenceReady: false, rawEvidenceExpectedTokenCount: registryTokens.length, rawEvidenceFreshTokenCount: 0,
      rawEvidenceMissingTokenCount: registryTokens.length, rawEvidenceStaleTokenCount: 0, rawEvidenceMissing: [], rawEvidenceSymbolReadiness: [], nearestPeerReadiness: [],
      readOnlyConsumerReadySymbolCount: 0, readOnlyConsumerObservations: [], readOnlyDirectionReadySymbolCount: 0, readOnlyDirectionObservations: [],
      readOnlyShadowInputReadySymbolCount: 0, readOnlyShadowInputObservations: [],
      selectorRuntimePolicyReady: false, selectorRuntimeAttached: false, selectorRuntimeBlockers: [],
      greekEvidenceStatus: "KITE_MATH_CROSSCHECK_OBSERVING",
      greekCrosscheckObservationCount: 0, greekCrosscheckFailureCount: 0, greekCrosscheckLastObservedAt: null,
      greekCrosscheckPolicySemantics: "SHADOW_CALIBRATION_ONLY", greekCrosscheckPolicyAuthority: "NONE",
      productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
      affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, failClosed: true,
    };
  }

  status(): H1LiveExactReadOnlyWebSocketStatus {
    return {
      ...this.value,
      rawEvidenceMissing: this.value.rawEvidenceMissing.map((x) => ({ ...x })),
      rawEvidenceSymbolReadiness: this.value.rawEvidenceSymbolReadiness.map((x) => ({ ...x, blockers: [...x.blockers] })),
      nearestPeerReadiness: this.value.nearestPeerReadiness.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyConsumerObservations: this.value.readOnlyConsumerObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyDirectionObservations: this.value.readOnlyDirectionObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyShadowInputObservations: this.value.readOnlyShadowInputObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      selectorRuntimeBlockers: [...this.value.selectorRuntimeBlockers],
    };
  }
  rawEvidenceStatus(nowIso: string) { return this.rawEvidence.status(nowIso); }
  constituentTicks(parentSymbol?: CanonicalMarketSymbol): CanonicalConstituentTick[] {
    return this.constituentEvidence?.ticks(parentSymbol) ?? [];
  }
  constituentEvidenceStatus(parentSymbol?: CanonicalMarketSymbol): CanonicalConstituentTickStoreStatus | null {
    return this.constituentEvidence?.status(parentSymbol) ?? null;
  }
  hawkEyeSource() {
    return this.constituentEvidence?.hawkEyeSource() ?? null;
  }

  private persistRawDepthEvidence(rows: H1LiveExactRawEvidenceRow[]): void {
    for (const row of rows) {
      const record = buildH1LiveExactRawDepthRecord(row);
      if (!record) continue;
      if (this.lastPersistedDepthMinuteByToken.get(record.instrumentToken) === record.minuteBucket) continue;
      this.lastPersistedDepthMinuteByToken.set(record.instrumentToken, record.minuteBucket);
      try {
        const pending = this.rawDepthPersist(record);
        if (pending && typeof (pending as Promise<void>).catch === "function") {
          void (pending as Promise<void>).catch((err) => {
            if (process.env.NODE_ENV !== "test") console.error("[H1_LIVE_EXACT_RAW_DEPTH_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
          });
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "test") console.error("[H1_LIVE_EXACT_RAW_DEPTH_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
      }
    }
  }

  private observeRawSpotTiming(packet: KiteDecodedPacket, receivedAt: string): void {
    const entry = this.config.readiness.registry?.get(packet?.instrumentToken ?? 0) ?? null;
    if (!entry || entry.role !== "SPOT" || (entry.symbol !== "NIFTY" && entry.symbol !== "SENSEX" && entry.symbol !== "BANKNIFTY")) return;
    if (packet.mode !== "full" || packet.isIndex !== true || typeof packet.exchangeTimestamp !== "string" ||
        !Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return;
    const observedMs = Date.parse(packet.exchangeTimestamp);
    const receivedMs = Date.parse(receivedAt);
    if (!Number.isFinite(observedMs) || !Number.isFinite(receivedMs)) return;

    const previous = this.latestRawSpotTimingBySymbol.get(entry.symbol);
    if (previous) {
      const previousReceivedMs = Date.parse(previous.receivedAt);
      const previousObservedMs = Date.parse(previous.observedAt);
      if (Number.isFinite(previousReceivedMs) && receivedMs < previousReceivedMs) return;
      if (Number.isFinite(previousReceivedMs) && receivedMs === previousReceivedMs &&
          Number.isFinite(previousObservedMs) && observedMs < previousObservedMs) return;
    }
    this.latestRawSpotTimingBySymbol.set(entry.symbol, {
      instrumentToken: entry.instrumentToken,
      observedAt: packet.exchangeTimestamp,
      receivedAt,
    });
    this.latestGreekUnderlyingBySymbol.set(entry.symbol, {
      source: "LIVE_RUNTIME_EXACT",
      symbol: entry.symbol,
      observedAt: packet.exchangeTimestamp,
      receivedAt,
      price: packet.lastPrice,
    });
  }

  private captureRawGreekTimingEvidence(packet: KiteDecodedPacket, receivedAt: string): void {
    const entry = this.config.readiness.registry?.get(packet?.instrumentToken ?? 0) ?? null;
    if (!entry || entry.role !== "OPTION" || packet.mode !== "full" || packet.isIndex ||
        !entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0 ||
        (entry.optionSide !== "CE" && entry.optionSide !== "PE") ||
        typeof packet.exchangeTimestamp !== "string") return;

    const underlying = this.latestRawSpotTimingBySymbol.get(entry.symbol as H1ExactUnderlyingObservation["symbol"]);
    if (!underlying) return;
    const record = buildH1LiveExactGreekTimingRecord({
      instrumentToken: entry.instrumentToken,
      symbol: entry.symbol as H1ExactUnderlyingObservation["symbol"],
      expiry: entry.expiry,
      strike: Number(entry.strike),
      optionSide: entry.optionSide,
      optionObservedAt: packet.exchangeTimestamp,
      optionReceivedAt: receivedAt,
      underlyingInstrumentToken: underlying.instrumentToken,
      underlyingObservedAt: underlying.observedAt,
      underlyingReceivedAt: underlying.receivedAt,
    });
    if (!record) return;
    if (this.lastPersistedGreekTimingMinuteByToken.get(record.instrumentToken) === record.minuteBucket) return;
    this.lastPersistedGreekTimingMinuteByToken.set(record.instrumentToken, record.minuteBucket);
    try {
      const pending = this.rawGreekTimingPersist(record);
      if (pending && typeof (pending as Promise<void>).catch === "function") {
        void (pending as Promise<void>).catch((err) => {
          if (process.env.NODE_ENV !== "test") console.error("[H1_LIVE_EXACT_GREEK_TIMING_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "test") console.error("[H1_LIVE_EXACT_GREEK_TIMING_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
    }
  }

  private captureKiteGreekMathCrosscheckEvidence(packet: KiteDecodedPacket, receivedAt: string): void {
    const entry = this.config.readiness.registry?.get(packet?.instrumentToken ?? 0) ?? null;
    if (!entry || entry.role !== "OPTION" || packet.mode !== "full" || packet.isIndex ||
        !entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0 ||
        (entry.optionSide !== "CE" && entry.optionSide !== "PE")) return;

    const underlying = this.latestGreekUnderlyingBySymbol.get(entry.symbol as H1ExactUnderlyingObservation["symbol"]);
    if (!underlying) return;

    const policy = H1_SELECTOR_SHADOW_PROFILE_V1.greekPolicy;
    const lotQuantity = this.config.readiness.lotSizeByOptionToken?.[entry.instrumentToken] ?? 0;
    const snapshot = bindKiteOptionPacketToH1ExactSnapshot({
      packet,
      registry: this.config.readiness.registry!,
      underlying,
      receivedAt,
      nowIso: receivedAt,
      orderQuantity: lotQuantity,
      greekPolicy: policy,
      maxSnapshotAgeMs: policy.maxAgeMs,
      maxCrossSourceSkewMs: policy.maxUnderlyingSkewMs,
    });
    if (!snapshot.ready || !snapshot.priceGreek) {
      this.value.greekCrosscheckFailureCount += 1;
      return;
    }

    const evidence = crosscheckH1KiteGreeks(snapshot.priceGreek, underlying, policy);
    if (!evidence.ready) {
      this.value.greekCrosscheckFailureCount += 1;
      return;
    }

    this.value.greekCrosscheckObservationCount += 1;
    this.value.greekCrosscheckLastObservedAt = evidence.observedAt;
    this.value.greekEvidenceStatus = "KITE_MATH_CROSSCHECK_OBSERVATIONS_AVAILABLE";

    const selectorDirectionAtCapture = this.selectorDirectionBySymbol.get(entry.symbol as H1ExactUnderlyingObservation["symbol"]) ?? null;
    const expectedPremiumDirectionAtCapture = deriveExpectedPremiumDirectionAtCapture(
      selectorDirectionAtCapture,
      entry.optionSide,
    );
    const directionContext = selectorDirectionAtCapture && expectedPremiumDirectionAtCapture
      ? {
          selectorDirectionAtCapture,
          expectedPremiumDirectionAtCapture,
          directionSourceId: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1" as const,
        }
      : null;
    const record = buildH1KiteGreekMathCrosscheckPersistRecord(
      entry.instrumentToken,
      snapshot,
      underlying,
      evidence,
      directionContext,
    );
    if (!record) return;
    if (this.lastPersistedGreekCrosscheckMinuteByToken.get(record.instrumentToken) === record.minuteBucket) return;
    this.lastPersistedGreekCrosscheckMinuteByToken.set(record.instrumentToken, record.minuteBucket);

    try {
      const pending = this.greekMathCrosscheckPersist(record);
      if (pending && typeof (pending as Promise<void>).catch === "function") {
        void (pending as Promise<void>).catch((err) => {
          if (process.env.NODE_ENV !== "test") console.error("[H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "test") console.error("[H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST] write failed without affecting live feed:", err instanceof Error ? err.message : err);
    }
  }

  start(): H1LiveExactReadOnlyWebSocketStatus {
    if (this.transport) throw new Error("H1_LIVE_EXACT_READONLY_ALREADY_STARTED");
    const selectorPolicySource = readH1SelectorCanonicalPolicySource(this.config.selectorPolicyEnv ?? process.env);
    const selectorRegistry = this.config.readiness.registry!;
    const lotSizeByToken = this.config.readiness.lotSizeByOptionToken ?? {};
    const optionEntries = selectorRegistry.entries().filter((entry) => entry.role === "OPTION");
    const quantityMissing = optionEntries.filter((entry) => !Number.isInteger(lotSizeByToken[entry.instrumentToken]) || lotSizeByToken[entry.instrumentToken] <= 0);
    this.value.selectorRuntimePolicyReady = selectorPolicySource.ready;
    if (!selectorPolicySource.ready || !selectorPolicySource.exactPolicy) {
      this.value.selectorRuntimeAttached = false;
      this.value.selectorRuntimeBlockers = [...selectorPolicySource.blockers];
    } else if (quantityMissing.length > 0) {
      this.value.selectorRuntimeAttached = false;
      this.value.selectorRuntimeBlockers = quantityMissing.map((entry) => `VERIFIED_LOT_SIZE_REQUIRED:${entry.instrumentToken}`);
    } else {
      const selectorProfile = selectorPolicySource.exactPolicy;
      this.selectorPeerStore = new H1ExactPeerRuntimeStore({
        registryEntries: selectorRegistry.entries(),
        classifierPolicy: {
          maxObservationGapMs: selectorProfile.premiumPolicy.maxObservationGapMs,
          minAbsolutePremiumMovePct: selectorProfile.premiumPolicy.minPremiumMovePct,
        },
        maxObservationAgeMs: selectorProfile.burdenPolicy.maxObservationAgeMs,
        requiredPeerCount: selectorProfile.burdenPolicy.requiredPeerCount,
        expectedDirectionFor: (entry) => {
          const direction = this.selectorDirectionBySymbol.get(entry.symbol);
          if (!direction || (entry.optionSide !== "CE" && entry.optionSide !== "PE")) throw new Error("VERIFIED_LIVE_DIRECTION_UNAVAILABLE");
          const optionShouldRise = (direction === "UP" && entry.optionSide === "CE") || (direction === "DOWN" && entry.optionSide === "PE");
          return optionShouldRise ? "UP" : "DOWN";
        },
      });
      this.selectorCoordinator = new H1KiteExactRuntimeCoordinator({
        registry: selectorRegistry,
        orderQuantityFor: (entry) => lotSizeByToken[entry.instrumentToken] ?? 0,
        greekPolicy: selectorProfile.greekPolicy,
        maxUnderlyingAgeMs: selectorProfile.greekPolicy.maxAgeMs,
        maxSnapshotAgeMs: selectorProfile.greekPolicy.maxAgeMs,
        maxCrossSourceSkewMs: selectorProfile.greekPolicy.maxUnderlyingSkewMs,
        publisherFor: (entry, previous, current) => {
          const peer = this.selectorPeerStore!.ingestAndResolve(entry.instrumentToken, previous, current, current.observedAt ?? "");
          return {
            moneyness: "ATM",
            multiExpiryPeers: peer.ready ? peer.resolver!.peers : [],
            premiumPolicy: selectorProfile.premiumPolicy,
            burdenPolicy: selectorProfile.burdenPolicy,
            capitalLiquidityDtePolicy: selectorProfile.capitalLiquidityDtePolicy,
          };
        },
      });
      this.value.selectorRuntimeAttached = true;
      this.value.selectorRuntimeBlockers = [];
    }
    this.transport = new KiteWebSocketTransport({
      apiKey: this.config.apiKey, accessToken: this.config.accessToken, instrumentTokens: [...this.allowedTokens], mode: "full", socketFactory: this.config.socketFactory,
      reconnect: { enabled: true, delayMs: this.config.reconnectDelayMs ?? 1_000, maxAttempts: this.config.reconnectMaxAttempts ?? 10 },
      onTicks: (ticks, receivedAt) => {
        this.value.lastPacketTimestamp = receivedAt;
        for (const tick of ticks) this.observeRawSpotTiming(tick, receivedAt);
        for (const tick of ticks) {
          if (!this.allowedTokens.has(tick.instrumentToken)) { this.value.rejectedPacketCount += 1; continue; }
