import { ImmediateEventTruthRecorder } from "./immediate-event-truth-recorder.js";
import { ImmediateMetricIngestBridge } from "./immediate-metric-ingest-bridge.js";
import { KiteWebSocketImmediateFeed } from "./kite-websocket-immediate-feed.js";
import { mapDecodedKitePacketToImmediate } from "./kite-decoded-tick-immediate-mapper.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import { ImmediateExpansionClusterClock, type ImmediateClusterClockConfig } from "./immediate-expansion-cluster-clock.js";
import { evaluateImmediateExpansionChain, type ImmediateExpansionChainResult, type ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";
import { KiteWebSocketPositioningEngine } from "./kite-websocket-positioning-engine.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type RuntimeTrendState = { side: "CE" | "PE" | "NONE"; valid: boolean };

export type KiteImmediateRuntimeCoreConfig = {
  registry: KiteImmediateTokenRegistry;
  positioningBySymbol?: Partial<Record<RecorderSymbol, KiteWebSocketPositioningEngine>>;
  cluster: ImmediateClusterClockConfig;
  maxTickAgeMs?: number;
  trendFor: (symbol: RecorderSymbol) => RuntimeTrendState;
  onDecision?: (result: ImmediateExpansionChainResult) => void | Promise<void>;
};

export type KiteImmediateRuntimePacketResult = {
  version: "KITE_IMMEDIATE_RUNTIME_CORE_V1";
  instrumentToken: number;
  ignoredReason: string | null;
  decision: ImmediateExpansionChainResult | null;
  freshEventsAdded: number;
  productionImpact: "NONE";
};

export class KiteImmediateRuntimeCore {
  readonly truthRecorder = new ImmediateEventTruthRecorder();
  readonly metricBridge = new ImmediateMetricIngestBridge(this.truthRecorder);
  readonly feed = new KiteWebSocketImmediateFeed(this.metricBridge);
  readonly clusterClock: ImmediateExpansionClusterClock;

  constructor(private readonly config: KiteImmediateRuntimeCoreConfig) {
    this.clusterClock = new ImmediateExpansionClusterClock(config.cluster);
  }

  async ingestPacket(packet: KiteDecodedPacket, receivedAt: string): Promise<KiteImmediateRuntimePacketResult> {
    const entry = this.config.registry.get(packet.instrumentToken);
    if (!entry) return this.result(packet.instrumentToken, "UNREGISTERED_INSTRUMENT_TOKEN", null, 0);
    const trend = this.config.trendFor(entry.symbol);
    const mapped = mapDecodedKitePacketToImmediate(packet, this.config.registry, receivedAt, trend.side, this.config.maxTickAgeMs ?? 5_000);
    if (!mapped.feedTick) return this.result(packet.instrumentToken, mapped.ignoredReason, null, 0);

    const feedResult = this.feed.ingestTick(mapped.feedTick);
    const freshEvents: ImmediateVerifiedEvent[] = feedResult.results
      .map((x) => x.detector.event)
      .filter((x): x is ImmediateVerifiedEvent => Boolean(x?.fresh && x.abnormalImmediateChange));

    if (mapped.optionOi) {
      const positioning = this.config.positioningBySymbol?.[entry.symbol];
      if (positioning) {
        const p = positioning.ingest(mapped.optionOi, trend.side);
        for (const row of p.detectorResults) {
          if (row.detector.event?.fresh && row.detector.event.abnormalImmediateChange) freshEvents.push(row.detector.event);
        }
        for (const row of p.migrationTruthRecords) {
          if (row.record?.event?.fresh && row.record.event.abnormalImmediateChange) freshEvents.push(row.record.event);
        }
      }
    }

    let decision: ImmediateExpansionChainResult | null = null;
    for (const event of freshEvents) {
      const cluster = this.clusterClock.observe(entry.symbol, event);
      decision = evaluateImmediateExpansionChain({
        symbol: entry.symbol,
        lockedTrendSide: trend.side,
        trendValid: trend.valid,
        clusterReady: cluster.clusterReady,
        events: cluster.events,
      });
      if (this.config.onDecision) await this.config.onDecision(decision);
    }

    return this.result(packet.instrumentToken, null, decision, freshEvents.length);
  }

  private result(instrumentToken: number, ignoredReason: string | null, decision: ImmediateExpansionChainResult | null, freshEventsAdded: number): KiteImmediateRuntimePacketResult {
    return {
      version: "KITE_IMMEDIATE_RUNTIME_CORE_V1",
      instrumentToken,
      ignoredReason,
      decision,
      freshEventsAdded,
      productionImpact: "NONE",
    };
  }
}
