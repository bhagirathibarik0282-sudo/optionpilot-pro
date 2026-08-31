import type { MetricEffect } from "./immediate-abnormal-change-detector.js";
import { ImmediateMetricIngestBridge, type ImmediateMetricIngestResult } from "./immediate-metric-ingest-bridge.js";
import { ImmediateEventTruthRecorder, type ImmediateTruthAppendResult } from "./immediate-event-truth-recorder.js";
import type { ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";
import type { KiteOptionOiObservation } from "./kite-decoded-tick-immediate-mapper.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type KitePositioningUniverseContract = {
  symbol: RecorderSymbol;
  expiry: string;
  optionTokens: Array<{ instrumentToken: number; strike: number; side: "CE" | "PE" }>;
  maxObservationAgeMs: number;
  pcrRisingEffect: MetricEffect;
  pcrFallingEffect: MetricEffect;
};

export type KitePositioningSnapshot = {
  version: "KITE_WEBSOCKET_POSITIONING_SNAPSHOT_V1";
  symbol: RecorderSymbol;
  expiry: string;
  complete: boolean;
  fresh: boolean;
  tokenCount: number;
  observedTokenCount: number;
  ceOiTotal: number | null;
  peOiTotal: number | null;
  pcr: number | null;
  callWall: { strike: number; oi: number } | null;
  putWall: { strike: number; oi: number } | null;
  oldestOccurredAt: string | null;
  newestOccurredAt: string | null;
  syncSpanMs: number | null;
};

export type KitePositioningIngestResult = {
  snapshot: KitePositioningSnapshot;
  detectorResults: ImmediateMetricIngestResult[];
  migrationTruthRecords: ImmediateTruthAppendResult[];
};

type StoredObservation = KiteOptionOiObservation;

function validateUniverse(contract: KitePositioningUniverseContract): void {
  if (!contract.symbol || !contract.expiry || !Array.isArray(contract.optionTokens) || contract.optionTokens.length === 0) {
    throw new Error("INVALID_KITE_POSITIONING_UNIVERSE");
  }
  if (!Number.isFinite(contract.maxObservationAgeMs) || contract.maxObservationAgeMs <= 0) {
    throw new Error("INVALID_KITE_POSITIONING_MAX_AGE");
  }
  const seen = new Set<number>();
  for (const row of contract.optionTokens) {
    if (!Number.isInteger(row.instrumentToken) || row.instrumentToken <= 0 || !Number.isFinite(row.strike) || row.strike <= 0 || !["CE", "PE"].includes(row.side)) {
      throw new Error("INVALID_KITE_POSITIONING_TOKEN");
    }
    if (seen.has(row.instrumentToken)) throw new Error("DUPLICATE_KITE_POSITIONING_TOKEN");
    seen.add(row.instrumentToken);
  }
  if (!contract.optionTokens.some((x) => x.side === "CE") || !contract.optionTokens.some((x) => x.side === "PE")) {
    throw new Error("KITE_POSITIONING_REQUIRES_BOTH_SIDES");
  }
}

export class KiteWebSocketPositioningEngine {
  private readonly latest = new Map<number, StoredObservation>();
  private previousCallWallStrike: number | null = null;
  private previousPutWallStrike: number | null = null;

  constructor(
    private readonly contract: KitePositioningUniverseContract,
    private readonly metricBridge: ImmediateMetricIngestBridge,
    private readonly truthRecorder: ImmediateEventTruthRecorder,
  ) {
    validateUniverse(contract);
  }

  ingest(observation: KiteOptionOiObservation, lockedTrendSide: "CE" | "PE" | "NONE"): KitePositioningIngestResult {
    if (observation.symbol !== this.contract.symbol || observation.expiry !== this.contract.expiry) {
      throw new Error("KITE_POSITIONING_UNIVERSE_MISMATCH");
    }
    const identity = this.contract.optionTokens.find((x) => x.instrumentToken === observation.instrumentToken);
    if (!identity || identity.strike !== observation.strike || identity.side !== observation.side) {
      throw new Error("KITE_POSITIONING_CONTRACT_MISMATCH");
    }
    if (!Number.isFinite(observation.oi) || observation.oi < 0 || !Number.isFinite(Date.parse(observation.occurredAt))) {
      throw new Error("INVALID_KITE_POSITIONING_OBSERVATION");
    }

    this.latest.set(observation.instrumentToken, observation);
    const snapshot = this.snapshot(observation.receivedAt);
    const detectorResults: ImmediateMetricIngestResult[] = [];
    const migrationTruthRecords: ImmediateTruthAppendResult[] = [];

    if (!snapshot.complete || !snapshot.fresh || snapshot.pcr == null || !snapshot.callWall || !snapshot.putWall) {
      return { snapshot, detectorResults, migrationTruthRecords };
    }

    detectorResults.push(this.metricBridge.ingest({
      symbol: this.contract.symbol,
      lockedTrendSide,
      fresh: true,
      sample: {
        id: `${this.contract.symbol}:${this.contract.expiry}:PCR:${snapshot.newestOccurredAt}`,
        family: "PCR",
        occurredAt: snapshot.newestOccurredAt!,
        value: snapshot.pcr,
        source: "KITE_WEBSOCKET",
        snapshotId: `kite-ws-positioning:${this.contract.symbol}:${this.contract.expiry}:${snapshot.newestOccurredAt}`,
        effectWhenRising: this.contract.pcrRisingEffect,
        effectWhenFalling: this.contract.pcrFallingEffect,
        factLabel: `${this.contract.symbol}|${this.contract.expiry}|PCR_FIXED_UNIVERSE`,
      },
    }));

    const callStrike = snapshot.callWall.strike;
    if (this.previousCallWallStrike == null || this.previousCallWallStrike === callStrike) {
      detectorResults.push(this.metricBridge.ingest({
        symbol: this.contract.symbol,
        lockedTrendSide,
        fresh: true,
        sample: {
          id: `${this.contract.symbol}:${this.contract.expiry}:CALL_WALL:${callStrike}:${snapshot.newestOccurredAt}`,
          family: "CALL_WALL",
          occurredAt: snapshot.newestOccurredAt!,
          value: snapshot.callWall.oi,
          source: "KITE_WEBSOCKET",
          snapshotId: `kite-ws-positioning:${this.contract.symbol}:${this.contract.expiry}:${snapshot.newestOccurredAt}`,
          effectWhenRising: "FAVOURS_PE",
          effectWhenFalling: "FAVOURS_CE",
          factLabel: `${this.contract.symbol}|${this.contract.expiry}|CALL_WALL_OI@${callStrike}`,
        },
      }));
    } else {
      const event: ImmediateVerifiedEvent = {
        id: `${this.contract.symbol}:${this.contract.expiry}:CALL_WALL_MIGRATION:${snapshot.newestOccurredAt}`,
        family: "CALL_WALL",
        occurredAt: snapshot.newestOccurredAt!,
        fact: `Call wall migrated ${this.previousCallWallStrike} -> ${callStrike}.`,
        abnormalImmediateChange: true,
        fresh: true,
        alignment: "NEUTRAL",
      };
      migrationTruthRecords.push(this.truthRecorder.append({
        symbol: this.contract.symbol,
        source: "KITE_WEBSOCKET",
        snapshotId: `kite-ws-positioning:${this.contract.symbol}:${this.contract.expiry}:${snapshot.newestOccurredAt}`,
        receivedAt: observation.receivedAt,
        event,
      }));
    }
    this.previousCallWallStrike = callStrike;

    const putStrike = snapshot.putWall.strike;
    if (this.previousPutWallStrike == null || this.previousPutWallStrike === putStrike) {
      detectorResults.push(this.metricBridge.ingest({
        symbol: this.contract.symbol,
        lockedTrendSide,
        fresh: true,
        sample: {
          id: `${this.contract.symbol}:${this.contract.expiry}:PUT_WALL:${putStrike}:${snapshot.newestOccurredAt}`,
          family: "PUT_WALL",
          occurredAt: snapshot.newestOccurredAt!,
          value: snapshot.putWall.oi,
          source: "KITE_WEBSOCKET",
          snapshotId: `kite-ws-positioning:${this.contract.symbol}:${this.contract.expiry}:${snapshot.newestOccurredAt}`,
          effectWhenRising: "FAVOURS_CE",
          effectWhenFalling: "FAVOURS_PE",
          factLabel: `${this.contract.symbol}|${this.contract.expiry}|PUT_WALL_OI@${putStrike}`,
        },
      }));
    } else {
      const event: ImmediateVerifiedEvent = {
        id: `${this.contract.symbol}:${this.contract.expiry}:PUT_WALL_MIGRATION:${snapshot.newestOccurredAt}`,
        family: "PUT_WALL",
        occurredAt: snapshot.newestOccurredAt!,
        fact: `Put wall migrated ${this.previousPutWallStrike} -> ${putStrike}.`,
        abnormalImmediateChange: true,
        fresh: true,
        alignment: "NEUTRAL",
      };
      migrationTruthRecords.push(this.truthRecorder.append({
        symbol: this.contract.symbol,
        source: "KITE_WEBSOCKET",
        snapshotId: `kite-ws-positioning:${this.contract.symbol}:${this.contract.expiry}:${snapshot.newestOccurredAt}`,
        receivedAt: observation.receivedAt,
        event,
      }));
    }
    this.previousPutWallStrike = putStrike;

    return { snapshot, detectorResults, migrationTruthRecords };
  }

  snapshot(receivedAt: string): KitePositioningSnapshot {
    const rows = this.contract.optionTokens.map((x) => this.latest.get(x.instrumentToken)).filter(Boolean) as StoredObservation[];
    const complete = rows.length === this.contract.optionTokens.length;
    if (!complete) return this.empty(rows.length);

    const receivedMs = Date.parse(receivedAt);
    if (!Number.isFinite(receivedMs)) throw new Error("INVALID_KITE_POSITIONING_RECEIVED_AT");
    const times = rows.map((x) => Date.parse(x.occurredAt));
    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const fresh = rows.every((x) => {
      const age = receivedMs - Date.parse(x.occurredAt);
      return age >= 0 && age <= this.contract.maxObservationAgeMs;
    });

    const ce = rows.filter((x) => x.side === "CE");
    const pe = rows.filter((x) => x.side === "PE");
    const ceOiTotal = ce.reduce((sum, x) => sum + x.oi, 0);
    const peOiTotal = pe.reduce((sum, x) => sum + x.oi, 0);
    const pcr = ceOiTotal > 0 ? peOiTotal / ceOiTotal : null;
    const call = ce.reduce((best, x) => !best || x.oi > best.oi ? x : best, null as StoredObservation | null);
    const put = pe.reduce((best, x) => !best || x.oi > best.oi ? x : best, null as StoredObservation | null);

    return {
      version: "KITE_WEBSOCKET_POSITIONING_SNAPSHOT_V1",
      symbol: this.contract.symbol,
      expiry: this.contract.expiry,
      complete: true,
      fresh,
      tokenCount: this.contract.optionTokens.length,
      observedTokenCount: rows.length,
      ceOiTotal,
      peOiTotal,
      pcr,
      callWall: call ? { strike: call.strike, oi: call.oi } : null,
      putWall: put ? { strike: put.strike, oi: put.oi } : null,
      oldestOccurredAt: new Date(oldest).toISOString(),
      newestOccurredAt: new Date(newest).toISOString(),
      syncSpanMs: newest - oldest,
    };
  }

  private empty(observedTokenCount: number): KitePositioningSnapshot {
    return {
      version: "KITE_WEBSOCKET_POSITIONING_SNAPSHOT_V1",
      symbol: this.contract.symbol,
      expiry: this.contract.expiry,
      complete: false,
      fresh: false,
      tokenCount: this.contract.optionTokens.length,
      observedTokenCount,
      ceOiTotal: null,
      peOiTotal: null,
      pcr: null,
      callWall: null,
      putWall: null,
      oldestOccurredAt: null,
      newestOccurredAt: null,
      syncSpanMs: null,
    };
  }
}
