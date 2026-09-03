import type { KiteH1ExactDualPathResult } from "./kite-h1-exact-dual-path-core.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import { KiteWebSocketTransport, type KiteSocketFactory } from "./kite-websocket-transport.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface KiteH1ExactDualPathIngestor {
  ingestPacket(packet: KiteDecodedPacket, receivedAt: string, nowIso?: string): Promise<KiteH1ExactDualPathResult>;
}

export interface KiteH1ExactShadowSupervisorConfig {
  enabled: boolean;
  apiKey?: string | null;
  accessToken?: string | null;
  registry: KiteImmediateTokenRegistry;
  runtime: KiteH1ExactDualPathIngestor;
  socketFactory?: KiteSocketFactory;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
}

export interface KiteH1ExactShadowSupervisorStatus {
  version: "KITE_H1_EXACT_SHADOW_SUPERVISOR_V1";
  enabled: boolean;
  connected: boolean;
  state: "DISABLED" | "READY" | "CONNECTING" | "RECONNECTING" | "OPEN" | "CLOSED" | "ERROR";
  subscribedTokenCount: number;
  lastPacketTimestamp: string | null;
  lastExactReadyTimestamp: string | null;
  processedPacketCount: number;
  dualPathBlockedCount: number;
  runtimeExceptionCount: number;
  reconnectCount: number;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

export class KiteH1ExactShadowSupervisor {
  private transport: KiteWebSocketTransport | null = null;
  private statusValue: KiteH1ExactShadowSupervisorStatus;

  constructor(private readonly config: KiteH1ExactShadowSupervisorConfig) {
    this.statusValue = {
      version: "KITE_H1_EXACT_SHADOW_SUPERVISOR_V1",
      enabled: config.enabled,
      connected: false,
      state: config.enabled ? "READY" : "DISABLED",
      subscribedTokenCount: config.enabled ? config.registry.tokens().length : 0,
      lastPacketTimestamp: null,
      lastExactReadyTimestamp: null,
      processedPacketCount: 0,
      dualPathBlockedCount: 0,
      runtimeExceptionCount: 0,
      reconnectCount: 0,
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  status(): KiteH1ExactShadowSupervisorStatus {
    return { ...this.statusValue };
  }

  start(): KiteH1ExactShadowSupervisorStatus {
    if (!this.config.enabled) return this.status();
    if (!this.config.apiKey?.trim() || !this.config.accessToken?.trim()) {
      throw new Error("KITE_H1_EXACT_SHADOW_CREDENTIALS_REQUIRED");
    }
    if (this.transport) throw new Error("KITE_H1_EXACT_SHADOW_ALREADY_STARTED");

    this.transport = new KiteWebSocketTransport({
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
      instrumentTokens: this.config.registry.tokens(),
      mode: "full",
      socketFactory: this.config.socketFactory,
      reconnect: {
        enabled: true,
        delayMs: this.config.reconnectDelayMs ?? 1_000,
        maxAttempts: this.config.reconnectMaxAttempts ?? 10,
      },
      onTicks: async (ticks, receivedAt) => {
        this.statusValue.lastPacketTimestamp = receivedAt;
        for (const tick of ticks) {
          try {
            const result = await this.config.runtime.ingestPacket(tick, receivedAt, receivedAt);
            this.statusValue.processedPacketCount += 1;
            if (!result.processed || result.blockers.length > 0) this.statusValue.dualPathBlockedCount += 1;
            if (result.exactReady) this.statusValue.lastExactReadyTimestamp = receivedAt;
          } catch {
            this.statusValue.runtimeExceptionCount += 1;
          }
        }
      },
      onState: (state) => {
        if (state === "RECONNECTING") this.statusValue.reconnectCount += 1;
        this.statusValue.state = state;
        this.statusValue.connected = state === "OPEN";
      },
      onTextMessage: () => {},
    });

    this.transport.connect();
    return this.status();
  }

  stop(): KiteH1ExactShadowSupervisorStatus {
    this.transport?.disconnect();
    this.transport = null;
    this.statusValue.connected = false;
    this.statusValue.state = this.config.enabled ? "CLOSED" : "DISABLED";
    return this.status();
  }
}
