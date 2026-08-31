import { decodeKiteBinaryFrame, type KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export const KITE_WS_ENDPOINT = "wss://ws.kite.trade" as const;

export type KiteSocketLike = {
  binaryType: string;
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void): void;
};

export type KiteSocketFactory = (url: string) => KiteSocketLike;

export type KiteWebSocketTransportConfig = {
  apiKey: string;
  accessToken: string;
  instrumentTokens: number[];
  mode?: "ltp" | "quote" | "full";
  socketFactory?: KiteSocketFactory;
  reconnect?: { enabled: boolean; delayMs?: number; maxAttempts?: number };
  onTicks: (ticks: KiteDecodedPacket[], receivedAt: string) => void | Promise<void>;
  onTextMessage?: (text: string) => void | Promise<void>;
  onState?: (state: "CONNECTING" | "OPEN" | "CLOSED" | "ERROR" | "RECONNECTING") => void;
};

export class KiteWebSocketTransport {
  private socket: KiteSocketLike | null = null;
  private readonly mode: "ltp" | "quote" | "full";
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: KiteWebSocketTransportConfig) {
    this.mode = config.mode ?? "full";
    if (!config.apiKey?.trim() || !config.accessToken?.trim()) throw new Error("KITE_WS_CREDENTIALS_REQUIRED");
    if (!Array.isArray(config.instrumentTokens) || config.instrumentTokens.length === 0) throw new Error("KITE_WS_TOKENS_REQUIRED");
    if (config.instrumentTokens.some((x) => !Number.isInteger(x) || x <= 0)) throw new Error("KITE_WS_INVALID_TOKEN");
    if (new Set(config.instrumentTokens).size !== config.instrumentTokens.length) throw new Error("KITE_WS_DUPLICATE_TOKEN");
    if (config.instrumentTokens.length > 3000) throw new Error("KITE_WS_TOKEN_LIMIT_EXCEEDED");
  }

  connect(): void {
    if (this.socket) throw new Error("KITE_WS_ALREADY_STARTED");
    this.manualDisconnect = false;
    this.openSocket(false);
  }

  private openSocket(isReconnect: boolean): void {
    const factory = this.config.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as KiteSocketLike);
    const url = `${KITE_WS_ENDPOINT}?api_key=${encodeURIComponent(this.config.apiKey)}&access_token=${encodeURIComponent(this.config.accessToken)}`;
    this.config.onState?.(isReconnect ? "RECONNECTING" : "CONNECTING");
    const socket = factory(url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      socket.send(JSON.stringify({ a: "subscribe", v: this.config.instrumentTokens }));
      socket.send(JSON.stringify({ a: "mode", v: [this.mode, this.config.instrumentTokens] }));
      this.config.onState?.("OPEN");
    });

    socket.addEventListener("message", (event: any) => {
      const receivedAt = new Date().toISOString();
      const data = event?.data;
      if (typeof data === "string") {
        void this.config.onTextMessage?.(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        const ticks = decodeKiteBinaryFrame(data);
        if (ticks.length > 0) void this.config.onTicks(ticks, receivedAt);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const ticks = decodeKiteBinaryFrame(bytes);
        if (ticks.length > 0) void this.config.onTicks(ticks, receivedAt);
      }
    });

    socket.addEventListener("error", () => this.config.onState?.("ERROR"));
    socket.addEventListener("close", () => {
      this.config.onState?.("CLOSED");
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || !this.config.reconnect?.enabled || this.reconnectTimer) return;
    const maxAttempts = this.config.reconnect.maxAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) return;
    this.reconnectAttempts += 1;
    const delayMs = this.config.reconnect.delayMs ?? 1000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect && !this.socket) this.openSocket(true);
    }, delayMs);
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.socket) return;
    this.socket.close(1000, "normal");
  }
}
