import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import type { KiteH1ExactDualPathResult } from "./kite-h1-exact-dual-path-core.js";

export interface KiteH1ExactShadowPacketProcessor {
  ingestPacket(packet: KiteDecodedPacket, receivedAt: string, nowIso?: string): Promise<KiteH1ExactDualPathResult>;
}

export interface KiteH1ExactShadowPacketBridgeStatus {
  version: "KITE_H1_EXACT_SHADOW_PACKET_BRIDGE_V1";
  packetCount: number;
  exactReadyCount: number;
  rejectedCount: number;
  lastPacketTimestamp: string | null;
  lastExactReadyTimestamp: string | null;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  opensTransport: false;
  failClosed: true;
}

export interface KiteH1ExactShadowBatchResult {
  version: "KITE_H1_EXACT_SHADOW_PACKET_BRIDGE_V1";
  accepted: boolean;
  results: KiteH1ExactDualPathResult[];
  blockers: string[];
  status: KiteH1ExactShadowPacketBridgeStatus;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  opensTransport: false;
  failClosed: true;
}

function validIso(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Pure shadow attachment boundary for decoded Kite packets. It does not open a
 * WebSocket, resolve credentials, start a service, publish Telegram messages,
 * alter verdicts, or grant execution authority. A caller must explicitly feed
 * already-decoded packets into it.
 */
export class KiteH1ExactShadowPacketBridge {
  private packetCount = 0;
  private exactReadyCount = 0;
  private rejectedCount = 0;
  private lastPacketTimestamp: string | null = null;
  private lastExactReadyTimestamp: string | null = null;

  constructor(private readonly processor: KiteH1ExactShadowPacketProcessor) {}

  status(): KiteH1ExactShadowPacketBridgeStatus {
    return {
      version: "KITE_H1_EXACT_SHADOW_PACKET_BRIDGE_V1",
      packetCount: this.packetCount,
      exactReadyCount: this.exactReadyCount,
      rejectedCount: this.rejectedCount,
      lastPacketTimestamp: this.lastPacketTimestamp,
      lastExactReadyTimestamp: this.lastExactReadyTimestamp,
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      opensTransport: false,
      failClosed: true,
    };
  }

  async ingestTicks(
    ticks: KiteDecodedPacket[],
    receivedAt: string,
    nowIso: string = receivedAt,
  ): Promise<KiteH1ExactShadowBatchResult> {
    const blockers: string[] = [];
    if (!Array.isArray(ticks) || ticks.length === 0) blockers.push("NO_DECODED_TICKS");
    if (!validIso(receivedAt) || !validIso(nowIso)) blockers.push("INVALID_SHADOW_PACKET_TIME");
    if (blockers.length > 0) {
      this.rejectedCount += Math.max(Array.isArray(ticks) ? ticks.length : 0, 1);
      return this.batch(false, [], blockers);
    }

    const results: KiteH1ExactDualPathResult[] = [];
    this.lastPacketTimestamp = receivedAt;
    for (const tick of ticks) {
      try {
        const result = await this.processor.ingestPacket(tick, receivedAt, nowIso);
        results.push(result);
        this.packetCount += 1;
        if (result.exactReady && result.blockers.length === 0) {
          this.exactReadyCount += 1;
          this.lastExactReadyTimestamp = nowIso;
        }
        if (!result.processed || result.blockers.length > 0) this.rejectedCount += 1;
      } catch {
        this.rejectedCount += 1;
        blockers.push(`PACKET_PROCESSOR_EXCEPTION:${tick?.instrumentToken ?? 0}`);
      }
    }

    return this.batch(blockers.length === 0, results, blockers);
  }

  private batch(
    accepted: boolean,
    results: KiteH1ExactDualPathResult[],
    blockers: string[],
  ): KiteH1ExactShadowBatchResult {
    return {
      version: "KITE_H1_EXACT_SHADOW_PACKET_BRIDGE_V1",
      accepted,
      results,
      blockers,
      status: this.status(),
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      opensTransport: false,
      failClosed: true,
    };
  }
}
