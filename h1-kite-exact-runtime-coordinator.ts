import type { H1ExactUnderlyingObservation, H1KiteGreekModelPolicy } from "./h1-kite-exact-price-greek-adapter.js";
import { mapKiteIndexFullPacketToH1ExactUnderlying } from "./h1-kite-exact-underlying-adapter.js";
import {
  H1KiteExactSelectorPublisherBridge,
  type H1KiteExactSelectorPublisherBridgeResult,
  type H1KiteExactPublisherContext,
} from "./h1-kite-exact-selector-publisher-bridge.js";
import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface H1KiteExactRuntimeCoordinatorConfig {
  registry: KiteImmediateTokenRegistry;
  orderQuantityFor: (entry: KiteImmediateTokenEntry) => number;
  greekPolicy: H1KiteGreekModelPolicy;
  publisherFor: (
    entry: KiteImmediateTokenEntry,
    previous: H1ExactSnapshotBundle,
    current: H1ExactSnapshotBundle,
  ) => H1KiteExactPublisherContext;
  maxUnderlyingAgeMs?: number;
  maxSnapshotAgeMs?: number;
  maxCrossSourceSkewMs?: number;
}

export interface H1KiteExactRuntimeCoordinatorResult {
  version: "H1_KITE_EXACT_RUNTIME_COORDINATOR_V1";
  ready: boolean;
  instrumentToken: number;
  action: "UNDERLYING_CACHED" | "OPTION_EVALUATED" | "IGNORED";
  bridge: H1KiteExactSelectorPublisherBridgeResult | null;
  blocker: string | null;
  productionImpact: "NONE";
  failClosed: true;
}

const VERSION = "H1_KITE_EXACT_RUNTIME_COORDINATOR_V1" as const;

function validTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Coordinates exact Kite index and option FULL packets without opening a socket
 * or attaching to server runtime. Only fresh forward SPOT evidence is cached.
 * OPTION evidence is evaluated only when a same-symbol exact underlying exists.
 * Publisher policy/peer context is resolved only after an exact snapshot pair
 * exists, preventing pre-snapshot inference or stale peer injection.
 */
export class H1KiteExactRuntimeCoordinator {
  private readonly underlyingBySymbol = new Map<RecorderSymbol, H1ExactUnderlyingObservation>();
  private readonly bridge = new H1KiteExactSelectorPublisherBridge();

  constructor(private readonly config: H1KiteExactRuntimeCoordinatorConfig) {}

  ingest(
    packet: KiteDecodedPacket,
    receivedAt: string,
    nowIso: string = receivedAt,
  ): H1KiteExactRuntimeCoordinatorResult {
    const token = packet?.instrumentToken ?? 0;
    const entry = this.config.registry.get(token);
    if (!entry) return this.result(token, "IGNORED", null, "UNREGISTERED_INSTRUMENT_TOKEN");

    if (entry.role === "SPOT") {
      const underlying = mapKiteIndexFullPacketToH1ExactUnderlying(
        packet,
        this.config.registry,
        receivedAt,
        this.config.maxUnderlyingAgeMs ?? 5_000,
      );
      if (!underlying) return this.result(token, "IGNORED", null, "INVALID_EXACT_UNDERLYING_PACKET");

      const previous = this.underlyingBySymbol.get(entry.symbol);
      const previousMs = validTime(previous?.observedAt);
      const currentMs = validTime(underlying.observedAt);
      if (previous && (previousMs == null || currentMs == null || currentMs <= previousMs)) {
        return this.result(token, "IGNORED", null, "NON_FORWARD_EXACT_UNDERLYING_CHRONOLOGY");
      }
      this.underlyingBySymbol.set(entry.symbol, underlying);
      return this.result(token, "UNDERLYING_CACHED", null, null);
    }

    if (entry.role !== "OPTION") {
      return this.result(token, "IGNORED", null, "NON_H1_EXACT_INSTRUMENT_ROLE");
    }

    const underlying = this.underlyingBySymbol.get(entry.symbol);
    if (!underlying) return this.result(token, "IGNORED", null, "SAME_SYMBOL_EXACT_UNDERLYING_UNAVAILABLE");

    let orderQuantity: number;
    try {
      orderQuantity = this.config.orderQuantityFor(entry);
    } catch {
      return this.result(token, "IGNORED", null, "EXACT_ORDER_QUANTITY_RESOLUTION_FAILED");
    }
    if (!Number.isInteger(orderQuantity) || orderQuantity <= 0) {
      return this.result(token, "IGNORED", null, "INVALID_EXACT_ORDER_QUANTITY");
    }

    const bridge = this.bridge.ingest({
      snapshot: {
        packet,
        registry: this.config.registry,
        underlying,
        receivedAt,
        nowIso,
        orderQuantity,
        greekPolicy: this.config.greekPolicy,
        maxSnapshotAgeMs: this.config.maxSnapshotAgeMs,
        maxCrossSourceSkewMs: this.config.maxCrossSourceSkewMs,
      },
      publisherFor: (previous, current) => this.config.publisherFor(entry, previous, current),
    });
    return this.result(token, "OPTION_EVALUATED", bridge, bridge.ready ? null : bridge.blockers.join("|"));
  }

  clear(): void {
    this.underlyingBySymbol.clear();
    this.bridge.clear();
  }

  getCachedUnderlyingCount(): number {
    return this.underlyingBySymbol.size;
  }

  private result(
    instrumentToken: number,
    action: H1KiteExactRuntimeCoordinatorResult["action"],
    bridge: H1KiteExactSelectorPublisherBridgeResult | null,
    blocker: string | null,
  ): H1KiteExactRuntimeCoordinatorResult {
    return {
      version: VERSION,
      ready: action === "UNDERLYING_CACHED" || bridge?.ready === true,
      instrumentToken,
      action,
      bridge,
      blocker,
      productionImpact: "NONE",
      failClosed: true,
    };
  }
}
