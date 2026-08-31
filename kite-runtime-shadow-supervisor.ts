import { KiteImmediateRuntimeCore, type KiteImmediateRuntimeCoreConfig } from "./kite-immediate-runtime-core.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import { KiteWebSocketTransport, type KiteSocketFactory } from "./kite-websocket-transport.js";

export type KiteShadowRuntimeStatus = {
  version: "KITE_RUNTIME_SHADOW_SUPERVISOR_V1";
  enabled: boolean;
  connected: boolean;
  state: "DISABLED" | "READY" | "CONNECTING" | "RECONNECTING" | "OPEN" | "CLOSED" | "ERROR";
  subscribedTokenCount: number;
  lastPacketTimestamp: string | null;
  lastDecisionTimestamp: string | null;
  reconnectCount: number;
  staleOrRejectedCount: number;
  productionImpact: "NONE";
};

export type KiteShadowRuntimeSupervisorConfig = {
  enabled: boolean;
  apiKey?: string | null;
  accessToken?: string | null;
  registry: KiteImmediateTokenRegistry;
  core: Omit<KiteImmediateRuntimeCoreConfig, "registry" | "onDecision"> & {
    onDecision?: KiteImmediateRuntimeCoreConfig["onDecision"];
  };
  socketFactory?: KiteSocketFactory;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
};

export class KiteShadowRuntimeSupervisor {
  private transport: KiteWebSocketTransport | null = null;
  private runtime: KiteImmediateRuntimeCore | null = null;
  private statusValue: KiteShadowRuntimeStatus;

  constructor(private readonly config: KiteShadowRuntimeSupervisorConfig) {
    this.statusValue = {
      version: "KITE_RUNTIME_SHADOW_SUPERVISOR_V1",
      enabled: config.enabled,
      connected: false,
      state: config.enabled ? "READY" : "DISABLED",
      subscribedTokenCount: config.enabled ? config.registry.tokens().length : 0,
      lastPacketTimestamp: null,
      lastDecisionTimestamp: null,
      reconnectCount: 0,
      staleOrRejectedCount: 0,
      productionImpact: "NONE",
    };
  }

  status(): KiteShadowRuntimeStatus {
    return { ...this.statusValue };
  }

  start(): KiteShadowRuntimeStatus {
    if (!this.config.enabled) return this.status();
    if (!this.config.apiKey?.trim() || !this.config.accessToken?.trim()) throw new Error("KITE_RUNTIME_SHADOW_CREDENTIALS_REQUIRED");
    if (this.transport) throw new Error("KITE_RUNTIME_SHADOW_ALREADY_STARTED");

    const userDecision = this.config.core.onDecision;
    this.runtime = new KiteImmediateRuntimeCore({
      ...this.config.core,
      registry: this.config.registry,
      onDecision: async (result) => {
        this.statusValue.lastDecisionTimestamp = new Date().toISOString();
        if (userDecision) await userDecision(result);
      },
    });

    this.transport = new KiteWebSocketTransport({
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
      instrumentTokens: this.config.registry.tokens(),
      mode: "full",
      socketFactory: this.config.socketFactory,
      reconnect: {
        enabled: true,
        delayMs: this.config.reconnectDelayMs ?? 1000,
        maxAttempts: this.config.reconnectMaxAttempts ?? 10,
      },
      onTicks: async (ticks, receivedAt) => {
        this.statusValue.lastPacketTimestamp = receivedAt;
        for (const tick of ticks) {
          const result = await this.runtime!.ingestPacket(tick, receivedAt);
          if (result.ignoredReason) this.statusValue.staleOrRejectedCount += 1;
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

  stop(): KiteShadowRuntimeStatus {
    this.transport?.disconnect();
    this.transport = null;
    this.statusValue.connected = false;
    this.statusValue.state = this.config.enabled ? "CLOSED" : "DISABLED";
    return this.status();
  }
}
