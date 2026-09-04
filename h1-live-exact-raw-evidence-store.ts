import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface H1LiveExactRawEvidenceRow {
  instrumentToken: number;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  role: "SPOT" | "OPTION";
  instrumentLabel: string;
  expiry: string | null;
  strike: number | null;
  optionSide: "CE" | "PE" | null;
  observedAt: string;
  receivedAt: string;
  ltp: number;
  bid: number | null;
  ask: number | null;
  bidQty: number | null;
  askQty: number | null;
}

export interface H1LiveExactRawEvidenceStatus {
  version: "H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1";
  ready: boolean;
  expectedTokenCount: number;
  freshTokenCount: number;
  staleTokenCount: number;
  missingTokenCount: number;
  rows: H1LiveExactRawEvidenceRow[];
  blockers: string[];
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

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export class H1LiveExactRawEvidenceStore {
  private readonly byToken = new Map<number, H1LiveExactRawEvidenceRow>();

  constructor(private readonly registry: KiteImmediateTokenRegistry, private readonly maxAgeMs = 5_000) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("H1_RAW_EVIDENCE_INVALID_MAX_AGE");
  }

  ingest(packet: KiteDecodedPacket, receivedAt: string): boolean {
    const entry = this.registry.get(packet?.instrumentToken ?? 0);
    if (!entry || (entry.role !== "SPOT" && entry.role !== "OPTION")) return false;
    if (entry.symbol !== "NIFTY" && entry.symbol !== "SENSEX" && entry.symbol !== "BANKNIFTY") return false;
    if (packet.mode !== "full" || !Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return false;

    const observedAt = packet.exchangeTimestamp;
    const observedMs = time(observedAt);
    const receivedMs = time(receivedAt);
    if (typeof observedAt !== "string" || observedMs == null || receivedMs == null) return false;
    const age = receivedMs - observedMs;
    if (age < 0 || age > this.maxAgeMs) return false;

    let bid: number | null = null;
    let ask: number | null = null;
    let bidQty: number | null = null;
    let askQty: number | null = null;

    if (entry.role === "SPOT") {
      if (packet.isIndex !== true) return false;
    } else {
      if (packet.isIndex) return false;
      if (entry.optionSide !== "CE" && entry.optionSide !== "PE") return false;
      if (!entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0) return false;
      const bestBid = packet.marketDepth?.buy?.[0];
      const bestAsk = packet.marketDepth?.sell?.[0];
      if (!bestBid || !bestAsk || !Number.isFinite(bestBid.price) || bestBid.price <= 0 ||
          !Number.isFinite(bestAsk.price) || bestAsk.price <= bestBid.price ||
          !Number.isInteger(bestBid.quantity) || bestBid.quantity < 0 ||
          !Number.isInteger(bestAsk.quantity) || bestAsk.quantity < 0) return false;
      bid = bestBid.price;
      ask = bestAsk.price;
      bidQty = bestBid.quantity;
      askQty = bestAsk.quantity;
    }

    const previous = this.byToken.get(entry.instrumentToken);
    const previousMs = time(previous?.observedAt);
    if (previousMs != null && observedMs < previousMs) return false;

    this.byToken.set(entry.instrumentToken, {
      instrumentToken: entry.instrumentToken,
      symbol: entry.symbol,
      role: entry.role,
      instrumentLabel: entry.instrumentLabel,
      expiry: entry.expiry ?? null,
      strike: Number.isFinite(entry.strike) ? Number(entry.strike) : null,
      optionSide: entry.optionSide ?? null,
      observedAt,
      receivedAt,
      ltp: packet.lastPrice,
      bid,
      ask,
      bidQty,
      askQty,
    });
    return true;
  }

  status(nowIso: string): H1LiveExactRawEvidenceStatus {
    const now = time(nowIso);
    const blockers: string[] = [];
    const expected = this.registry.tokens();
    if (now == null) blockers.push("INVALID_NOW");

    const rows: H1LiveExactRawEvidenceRow[] = [];
    let stale = 0;
    let missing = 0;
    for (const token of expected) {
      const row = this.byToken.get(token);
      if (!row) { missing += 1; continue; }
      const observedMs = time(row.observedAt);
      if (now == null || observedMs == null || now < observedMs || now - observedMs > this.maxAgeMs) {
        stale += 1;
        continue;
      }
      rows.push({ ...row });
    }
    if (missing) blockers.push(`MISSING_EXACT_TOKENS:${missing}`);
    if (stale) blockers.push(`STALE_EXACT_TOKENS:${stale}`);

    return {
      version: "H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1",
      ready: blockers.length === 0 && rows.length === expected.length,
      expectedTokenCount: expected.length,
      freshTokenCount: rows.length,
      staleTokenCount: stale,
      missingTokenCount: missing,
      rows,
      blockers,
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
}
