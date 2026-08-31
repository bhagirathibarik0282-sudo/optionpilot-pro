import type { ImmediateEventFamily } from "./immediate-expansion-chain.js";
import type { MetricEffect } from "./immediate-abnormal-change-detector.js";
import { ImmediateMetricIngestBridge, type ImmediateMetricIngestResult } from "./immediate-metric-ingest-bridge.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export const KITE_WEBSOCKET_IMMEDIATE_SOURCE = "KITE_WEBSOCKET" as const;

export type KiteWebSocketMetricUpdate = {
  family: ImmediateEventFamily;
  metric: string;
  value: number;
  effectWhenRising: MetricEffect;
  effectWhenFalling: MetricEffect;
};

export type KiteWebSocketDecodedTick = {
  transportSource: typeof KITE_WEBSOCKET_IMMEDIATE_SOURCE;
  symbol: RecorderSymbol;
  instrumentToken: number;
  instrumentLabel: string;
  occurredAt: string;
  receivedAt: string;
  snapshotId?: string | null;
  lockedTrendSide: "CE" | "PE" | "NONE";
  freshnessVerified: boolean;
  updates: KiteWebSocketMetricUpdate[];
};

export type KiteWebSocketFeedResult = {
  version: "KITE_WEBSOCKET_IMMEDIATE_FEED_CONTRACT_V1";
  source: typeof KITE_WEBSOCKET_IMMEDIATE_SOURCE;
  symbol: RecorderSymbol;
  instrumentToken: number;
  occurredAt: string;
  acceptedUpdates: number;
  results: ImmediateMetricIngestResult[];
  restFallbackAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
};

function validIso(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Research-shadow contract that accepts only decoded Kite WebSocket updates.
 * It intentionally does not open the socket or decode Kite binary packets; the
 * transport must prove KITE_WEBSOCKET provenance before data can enter the
 * immediate-event detector. REST/snapshot data is rejected by construction.
 */
export class KiteWebSocketImmediateFeed {
  constructor(private readonly metricBridge: ImmediateMetricIngestBridge) {}

  ingestTick(tick: KiteWebSocketDecodedTick): KiteWebSocketFeedResult {
    if (!tick || tick.transportSource !== KITE_WEBSOCKET_IMMEDIATE_SOURCE) {
      throw new Error("IMMEDIATE_FEED_REQUIRES_KITE_WEBSOCKET");
    }
    if (!Number.isInteger(tick.instrumentToken) || tick.instrumentToken <= 0) {
      throw new Error("INVALID_KITE_INSTRUMENT_TOKEN");
    }
    if (!tick.instrumentLabel?.trim() || !validIso(tick.occurredAt) || !validIso(tick.receivedAt)) {
      throw new Error("INVALID_KITE_WEBSOCKET_TICK_METADATA");
    }
    if (!Array.isArray(tick.updates) || tick.updates.length === 0) {
      throw new Error("NO_KITE_WEBSOCKET_METRIC_UPDATES");
    }

    const results = tick.updates.map((update, index) => {
      if (!update.metric?.trim() || !Number.isFinite(update.value)) {
        throw new Error("INVALID_KITE_WEBSOCKET_METRIC_UPDATE");
      }
      const metricKey = `${tick.instrumentLabel.trim()}#${tick.instrumentToken}:${update.metric.trim()}`;
      return this.metricBridge.ingest({
        symbol: tick.symbol,
        lockedTrendSide: tick.lockedTrendSide,
        fresh: tick.freshnessVerified,
        sample: {
          id: `${tick.instrumentToken}:${update.metric}:${tick.occurredAt}:${index}`,
          family: update.family,
          occurredAt: tick.occurredAt,
          value: update.value,
          source: KITE_WEBSOCKET_IMMEDIATE_SOURCE,
          snapshotId: tick.snapshotId ?? null,
          effectWhenRising: update.effectWhenRising,
          effectWhenFalling: update.effectWhenFalling,
          factLabel: metricKey,
        },
      });
    });

    return {
      version: "KITE_WEBSOCKET_IMMEDIATE_FEED_CONTRACT_V1",
      source: KITE_WEBSOCKET_IMMEDIATE_SOURCE,
      symbol: tick.symbol,
      instrumentToken: tick.instrumentToken,
      occurredAt: tick.occurredAt,
      acceptedUpdates: results.length,
      results,
      restFallbackAllowed: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
    };
  }
}
