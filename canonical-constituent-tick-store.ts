import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { CanonicalConstituentTick } from "./canonical-constituent-live-component.js";
import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface CanonicalConstituentTickStoreStatus {
  version: "CANONICAL_CONSTITUENT_TICK_STORE_V1";
  expectedTokenCount: number;
  availableTokenCount: number;
  rejectedPacketCount: number;
  lastIngestSeq: number;
  missingTokens: number[];
  readOnly: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsCandidateAuthority: false;
  failClosed: true;
}

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Captures only explicitly registered constituent packets from the shared Kite WebSocket.
 * It records exchange/receive/process time plus a local monotonic ingest sequence.
 * It does not infer membership, direction, breadth, quality, candidates or execution.
 */
export class CanonicalConstituentTickStore {
  private readonly registryByToken = new Map<number, CanonicalConstituentTokenEntry>();
  private readonly latestByToken = new Map<number, CanonicalConstituentTick>();
  private rejectedPacketCount = 0;
  private ingestSeq = 0;

  constructor(entries: CanonicalConstituentTokenEntry[]) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("CANONICAL_CONSTITUENT_TICK_STORE_REGISTRY_REQUIRED");
    }
    for (const entry of entries) {
      if (!Number.isInteger(entry.instrumentToken) || entry.instrumentToken <= 0) {
        throw new Error("CANONICAL_CONSTITUENT_TICK_STORE_TOKEN_INVALID");
      }
      if (this.registryByToken.has(entry.instrumentToken)) {
        throw new Error(`CANONICAL_CONSTITUENT_TICK_STORE_TOKEN_DUPLICATE:${entry.instrumentToken}`);
      }
      this.registryByToken.set(entry.instrumentToken, { ...entry });
    }
  }

  tokens(): number[] {
    return [...this.registryByToken.keys()];
  }

  hasToken(instrumentToken: number): boolean {
    return this.registryByToken.has(instrumentToken);
  }

  ingest(packet: KiteDecodedPacket, receivedAt: string, processedAtMs = Date.now()): boolean {
    const entry = this.registryByToken.get(packet?.instrumentToken ?? 0);
    if (!entry) return false;

    const exchangeTimestampMs = time(packet.exchangeTimestamp);
    const receivedAtMs = time(receivedAt);
    const valid = packet.mode === "full"
      && Number.isFinite(packet.lastPrice)
      && packet.lastPrice > 0
      && exchangeTimestampMs != null
      && receivedAtMs != null
      && Number.isFinite(processedAtMs)
      && processedAtMs >= receivedAtMs
      && exchangeTimestampMs <= receivedAtMs;

    if (!valid) {
      this.rejectedPacketCount += 1;
      return false;
    }

    const previous = this.latestByToken.get(entry.instrumentToken);
    if (previous && exchangeTimestampMs < previous.exchangeTimestampMs) {
      this.rejectedPacketCount += 1;
      return false;
    }

    this.ingestSeq += 1;
    this.latestByToken.set(entry.instrumentToken, {
      instrumentToken: entry.instrumentToken,
      exchangeTimestampMs,
      receivedAtMs,
      processedAtMs,
      ingestSeq: this.ingestSeq,
      ltp: packet.lastPrice,
    });
    return true;
  }

  ticks(parentSymbol?: CanonicalMarketSymbol): CanonicalConstituentTick[] {
    const allowed = parentSymbol == null
      ? null
      : new Set(
        [...this.registryByToken.values()]
          .filter((entry) => entry.parentSymbol === parentSymbol)
          .map((entry) => entry.instrumentToken),
      );
    return [...this.latestByToken.values()]
      .filter((tick) => allowed == null || allowed.has(tick.instrumentToken))
      .sort((a, b) => a.ingestSeq - b.ingestSeq)
      .map((tick) => ({ ...tick }));
  }

  status(parentSymbol?: CanonicalMarketSymbol): CanonicalConstituentTickStoreStatus {
    const expected = [...this.registryByToken.values()]
      .filter((entry) => parentSymbol == null || entry.parentSymbol === parentSymbol)
      .map((entry) => entry.instrumentToken);
    const missingTokens = expected.filter((token) => !this.latestByToken.has(token));
    return {
      version: "CANONICAL_CONSTITUENT_TICK_STORE_V1",
      expectedTokenCount: expected.length,
      availableTokenCount: expected.length - missingTokens.length,
      rejectedPacketCount: this.rejectedPacketCount,
      lastIngestSeq: this.ingestSeq,
      missingTokens,
      readOnly: true,
      forwardsDownstream: false,
      affectsDirection: false,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      grantsCandidateAuthority: false,
      failClosed: true,
    };
  }
}
