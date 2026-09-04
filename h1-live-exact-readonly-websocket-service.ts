import type { H1LiveExactMarketWiringReadinessResult } from "./h1-live-exact-market-wiring-readiness.js";
import { H1LiveExactRawEvidenceStore, type H1LiveExactRawEvidenceMissing } from "./h1-live-exact-raw-evidence-store.js";
import { KiteWebSocketTransport, type KiteSocketFactory } from "./kite-websocket-transport.js";

export interface H1LiveExactReadOnlyWebSocketServiceConfig {
  readiness: H1LiveExactMarketWiringReadinessResult;
  apiKey: string;
  accessToken: string;
  socketFactory?: KiteSocketFactory;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
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
  greekEvidenceStatus: "NOT_CONFIGURED";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

export class H1LiveExactReadOnlyWebSocketService {
  private transport: KiteWebSocketTransport | null = null;
  private readonly allowedTokens: Set<number>;
  private readonly firstSeenTokens = new Set<number>();
  private readonly rawEvidence: H1LiveExactRawEvidenceStore;
  private value: H1LiveExactReadOnlyWebSocketStatus;

  constructor(private readonly config: H1LiveExactReadOnlyWebSocketServiceConfig) {
    if (!config.readiness?.ready || !config.readiness.registry || config.readiness.instrumentTokens.length === 0) {
      throw new Error("H1_LIVE_EXACT_READINESS_REQUIRED");
    }
    if (config.readiness.mode !== "full" || config.readiness.startsSocket !== false ||
        config.readiness.affectsVerdict !== false || config.readiness.affectsExecution !== false ||
        config.readiness.affectsTelegram !== false) {
      throw new Error("H1_LIVE_EXACT_READINESS_SAFETY_CONTRACT_INVALID");
    }
    if (!config.apiKey?.trim() || !config.accessToken?.trim()) throw new Error("KITE_H1_READONLY_CREDENTIALS_REQUIRED");

    const registryTokens = config.readiness.registry.tokens();
    if (registryTokens.length !== config.readiness.instrumentTokens.length ||
        registryTokens.some((token) => !config.readiness.instrumentTokens.includes(token))) {
      throw new Error("H1_LIVE_EXACT_READINESS_TOKEN_MISMATCH");
    }
    this.allowedTokens = new Set(registryTokens);
    this.rawEvidence = new H1LiveExactRawEvidenceStore(config.readiness.registry);
    this.value = {
      version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1",
      started: false,
      connected: false,
      state: "READY",
      subscribedTokenCount: registryTokens.length,
      receivedPacketCount: 0,
      rejectedPacketCount: 0,
      lastPacketTimestamp: null,
      rawEvidenceReady: false,
      rawEvidenceExpectedTokenCount: registryTokens.length,
      rawEvidenceFreshTokenCount: 0,
      rawEvidenceMissingTokenCount: registryTokens.length,
      rawEvidenceStaleTokenCount: 0,
      rawEvidenceMissing: [],
      greekEvidenceStatus: "NOT_CONFIGURED",
      productionImpact: "NONE",
      readOnly: true,
      forwardsDownstream: false,
      affectsDirection: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    };
  }

  status(): H1LiveExactReadOnlyWebSocketStatus { return { ...this.value, rawEvidenceMissing: this.value.rawEvidenceMissing.map((x) => ({ ...x })) }; }

  rawEvidenceStatus(nowIso: string) { return this.rawEvidence.status(nowIso); }

  start(): H1LiveExactReadOnlyWebSocketStatus {
    if (this.transport) throw new Error("H1_LIVE_EXACT_READONLY_ALREADY_STARTED");
    this.transport = new KiteWebSocketTransport({
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
      instrumentTokens: [...this.allowedTokens],
      mode: "full",
      socketFactory: this.config.socketFactory,
      reconnect: {
        enabled: true,
        delayMs: this.config.reconnectDelayMs ?? 1_000,
        maxAttempts: this.config.reconnectMaxAttempts ?? 10,
      },
      onTicks: (ticks, receivedAt) => {
        this.value.lastPacketTimestamp = receivedAt;
        for (const tick of ticks) {
          if (!this.allowedTokens.has(tick.instrumentToken)) {
            this.value.rejectedPacketCount += 1;
            continue;
          }
          this.value.receivedPacketCount += 1;
          this.rawEvidence.ingest(tick, receivedAt);
          if (!this.firstSeenTokens.has(tick.instrumentToken)) {
            this.firstSeenTokens.add(tick.instrumentToken);
            const entry = this.config.readiness.registry?.get(tick.instrumentToken) ?? null;
            if (process.env.NODE_ENV !== "test" && entry) {
              console.log(`[H1_DYNAMIC_READONLY_TOKEN_PACKET] ${JSON.stringify({
                instrumentToken: entry.instrumentToken,
                symbol: entry.symbol,
                role: entry.role,
                instrumentLabel: entry.instrumentLabel,
                expiry: entry.expiry ?? null,
                strike: entry.strike ?? null,
                optionSide: entry.optionSide ?? null,
                receivedAt,
                readOnly: true,
                forwardsDownstream: false,
              })}`);
            }
          }
        }
        const evidence = this.rawEvidence.status(receivedAt);
        this.value.rawEvidenceReady = evidence.ready;
        this.value.rawEvidenceExpectedTokenCount = evidence.expectedTokenCount;
        this.value.rawEvidenceFreshTokenCount = evidence.freshTokenCount;
        this.value.rawEvidenceMissingTokenCount = evidence.missingTokenCount;
        this.value.rawEvidenceStaleTokenCount = evidence.staleTokenCount;
        this.value.rawEvidenceMissing = evidence.missing;
      },
      onTextMessage: () => {},
      onState: (state) => {
        this.value.state = state;
        this.value.connected = state === "OPEN";
      },
    });
    this.value.started = true;
    this.transport.connect();
    return this.status();
  }

  stop(): H1LiveExactReadOnlyWebSocketStatus {
    this.transport?.disconnect();
    this.transport = null;
    this.value.started = false;
    this.value.connected = false;
    this.value.state = "CLOSED";
    return this.status();
  }
}
