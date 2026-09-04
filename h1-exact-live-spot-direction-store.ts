import { deriveH1ExactLiveSpotDirection, type H1ExactLiveSpotDirectionPolicy, type H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";
import { mapKiteIndexFullPacketToH1ExactUnderlying } from "./h1-kite-exact-underlying-adapter.js";
import type { H1ExactUnderlyingObservation } from "./h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface H1ExactLiveSpotDirectionStoreConfig {
  registry: KiteImmediateTokenRegistry;
  policy: H1ExactLiveSpotDirectionPolicy;
  maxUnderlyingAgeMs?: number;
}

export interface H1ExactLiveSpotDirectionStoreIngestResult {
  version: "H1_EXACT_LIVE_SPOT_DIRECTION_STORE_V1";
  accepted: boolean;
  symbol: RecorderSymbol | null;
  seeded: boolean;
  direction: H1ExactLiveSpotDirectionResult | null;
  blocker: string | null;
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const VERSION = "H1_EXACT_LIVE_SPOT_DIRECTION_STORE_V1" as const;

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export class H1ExactLiveSpotDirectionStore {
  private readonly previousBySymbol = new Map<RecorderSymbol, H1ExactUnderlyingObservation>();
  private readonly directionBySymbol = new Map<RecorderSymbol, H1ExactLiveSpotDirectionResult>();

  constructor(private readonly config: H1ExactLiveSpotDirectionStoreConfig) {}

  ingest(packet: KiteDecodedPacket, receivedAt: string): H1ExactLiveSpotDirectionStoreIngestResult {
    const entry = this.config.registry.get(packet?.instrumentToken ?? 0);
    if (!entry || entry.role !== "SPOT") return this.result(false, null, false, null, "NON_SPOT_IGNORED");

    const current = mapKiteIndexFullPacketToH1ExactUnderlying(
      packet,
      this.config.registry,
      receivedAt,
      this.config.maxUnderlyingAgeMs ?? 5_000,
    );
    if (!current) {
      this.directionBySymbol.delete(entry.symbol);
      return this.result(false, entry.symbol, false, null, "INVALID_EXACT_SPOT_OBSERVATION");
    }

    const previous = this.previousBySymbol.get(entry.symbol);
    if (!previous) {
      this.previousBySymbol.set(entry.symbol, current);
      this.directionBySymbol.delete(entry.symbol);
      return this.result(true, entry.symbol, true, null, null);
    }

    const previousMs = time(previous.observedAt);
    const currentMs = time(current.observedAt);
    if (previousMs == null || currentMs == null || currentMs <= previousMs) {
      this.directionBySymbol.delete(entry.symbol);
      return this.result(false, entry.symbol, false, null, "NON_FORWARD_EXACT_SPOT_CHRONOLOGY");
    }

    const direction = deriveH1ExactLiveSpotDirection(previous, current, this.config.policy);
    this.previousBySymbol.set(entry.symbol, current);
    this.directionBySymbol.set(entry.symbol, direction);
    return this.result(direction.ready, entry.symbol, false, direction, direction.ready ? null : direction.blockers.join("|"));
  }

  directionFor(symbol: RecorderSymbol): H1ExactLiveSpotDirectionResult | null {
    const value = this.directionBySymbol.get(symbol);
    return value ? { ...value, blockers: [...value.blockers] } : null;
  }

  clear(): void {
    this.previousBySymbol.clear();
    this.directionBySymbol.clear();
  }

  private result(
    accepted: boolean,
    symbol: RecorderSymbol | null,
    seeded: boolean,
    direction: H1ExactLiveSpotDirectionResult | null,
    blocker: string | null,
  ): H1ExactLiveSpotDirectionStoreIngestResult {
    return {
      version: VERSION,
      accepted,
      symbol,
      seeded,
      direction,
      blocker,
      productionImpact: "NONE",
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    };
  }
}
