import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
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

export interface H1LiveExactRawEvidenceMissing {
  instrumentToken: number;
  symbol: string;
  role: string;
  instrumentLabel: string;
  expiry: string | null;
  strike: number | null;
  optionSide: string | null;
  reason: string;
}

export interface H1LiveExactRawEvidenceSymbolReadiness {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  primaryExpiry: string | null;
  primaryReady: boolean;
  multiExpiryReady: boolean;
  primaryExpectedTokenCount: number;
  primaryFreshTokenCount: number;
  totalExpectedTokenCount: number;
  totalFreshTokenCount: number;
  blockers: string[];
}

export interface H1LiveExactRawEvidenceStatus {
  version: "H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1";
  ready: boolean;
  expectedTokenCount: number;
  freshTokenCount: number;
  staleTokenCount: number;
  missingTokenCount: number;
  rows: H1LiveExactRawEvidenceRow[];
  missing: H1LiveExactRawEvidenceMissing[];
  symbolReadiness: H1LiveExactRawEvidenceSymbolReadiness[];
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
  private readonly lastRejectByToken = new Map<number, string>();

  constructor(private readonly registry: KiteImmediateTokenRegistry, private readonly maxAgeMs = 5_000) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("H1_RAW_EVIDENCE_INVALID_MAX_AGE");
  }

  private reject(entry: KiteImmediateTokenEntry | null, reason: string): false {
    if (entry) this.lastRejectByToken.set(entry.instrumentToken, reason);
    return false;
  }

  ingest(packet: KiteDecodedPacket, receivedAt: string): boolean {
    const entry = this.registry.get(packet?.instrumentToken ?? 0);
    if (!entry || (entry.role !== "SPOT" && entry.role !== "OPTION")) return false;
    if (entry.symbol !== "NIFTY" && entry.symbol !== "SENSEX" && entry.symbol !== "BANKNIFTY") return this.reject(entry, "INVALID_SYMBOL");
    if (packet.mode !== "full") return this.reject(entry, "NOT_FULL_PACKET");
    if (!Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return this.reject(entry, "INVALID_LTP");

    const observedAt = packet.exchangeTimestamp;
    const observedMs = time(observedAt);
    const receivedMs = time(receivedAt);
    if (typeof observedAt !== "string" || observedMs == null || receivedMs == null) return this.reject(entry, "INVALID_TIMESTAMP");
    const age = receivedMs - observedMs;
    if (age < 0) return this.reject(entry, "FUTURE_EVIDENCE");
    if (age > this.maxAgeMs) return this.reject(entry, "STALE_EVIDENCE");

    let bid: number | null = null;
    let ask: number | null = null;
    let bidQty: number | null = null;
    let askQty: number | null = null;

    if (entry.role === "SPOT") {
      if (packet.isIndex !== true) return this.reject(entry, "SPOT_NOT_INDEX_PACKET");
    } else {
      if (packet.isIndex) return this.reject(entry, "OPTION_IS_INDEX_PACKET");
      if (entry.optionSide !== "CE" && entry.optionSide !== "PE") return this.reject(entry, "OPTION_SIDE_INVALID");
      if (!entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0) return this.reject(entry, "OPTION_IDENTITY_INVALID");
      const bestBid = packet.marketDepth?.buy?.[0];
      const bestAsk = packet.marketDepth?.sell?.[0];
      if (!bestBid || !bestAsk) return this.reject(entry, "DEPTH_MISSING");
      if (!Number.isFinite(bestBid.price) || bestBid.price <= 0) return this.reject(entry, "BEST_BID_INVALID");
      if (!Number.isFinite(bestAsk.price) || bestAsk.price <= bestBid.price) return this.reject(entry, "BEST_ASK_INVALID_OR_NOT_ABOVE_BID");
      if (!Number.isInteger(bestBid.quantity) || bestBid.quantity < 0) return this.reject(entry, "BEST_BID_QTY_INVALID");
      if (!Number.isInteger(bestAsk.quantity) || bestAsk.quantity < 0) return this.reject(entry, "BEST_ASK_QTY_INVALID");
      bid = bestBid.price;
      ask = bestAsk.price;
      bidQty = bestBid.quantity;
      askQty = bestAsk.quantity;
    }

    const previous = this.byToken.get(entry.instrumentToken);
    const previousMs = time(previous?.observedAt);
    if (previousMs != null && observedMs < previousMs) return this.reject(entry, "NON_FORWARD_CHRONOLOGY");

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
    this.lastRejectByToken.delete(entry.instrumentToken);
    return true;
  }

  status(nowIso: string): H1LiveExactRawEvidenceStatus {
    const now = time(nowIso);
    const blockers: string[] = [];
    const expected = this.registry.tokens();
    if (now == null) blockers.push("INVALID_NOW");

    const rows: H1LiveExactRawEvidenceRow[] = [];
    const missing: H1LiveExactRawEvidenceMissing[] = [];
    let stale = 0;
    for (const token of expected) {
      const entry = this.registry.get(token)!;
      const row = this.byToken.get(token);
      if (!row) {
        missing.push({
          instrumentToken: token,
          symbol: entry.symbol,
          role: entry.role,
          instrumentLabel: entry.instrumentLabel,
          expiry: entry.expiry ?? null,
          strike: Number.isFinite(entry.strike) ? Number(entry.strike) : null,
          optionSide: entry.optionSide ?? null,
          reason: this.lastRejectByToken.get(token) ?? "NO_VALID_EVIDENCE_YET",
        });
        continue;
      }
      const observedMs = time(row.observedAt);
      if (now == null || observedMs == null || now < observedMs || now - observedMs > this.maxAgeMs) {
        stale += 1;
        continue;
      }
      rows.push({ ...row });
    }
    if (missing.length) blockers.push(`MISSING_EXACT_TOKENS:${missing.length}`);
    if (stale) blockers.push(`STALE_EXACT_TOKENS:${stale}`);

    const freshTokens = new Set(rows.map((row) => row.instrumentToken));
    const symbols = this.registry.coveredSymbols().filter((s): s is "NIFTY" | "SENSEX" | "BANKNIFTY" =>
      s === "NIFTY" || s === "SENSEX" || s === "BANKNIFTY");
    const symbolReadiness = symbols.map((symbol): H1LiveExactRawEvidenceSymbolReadiness => {
      const entries = this.registry.entries().filter((entry) => entry.symbol === symbol && (entry.role === "SPOT" || entry.role === "OPTION"));
      const expiries = [...new Set(entries.filter((entry) => entry.role === "OPTION" && entry.expiry).map((entry) => entry.expiry!))].sort();
      const primaryExpiry = expiries[0] ?? null;
      const primaryEntries = entries.filter((entry) => entry.role === "SPOT" || (entry.role === "OPTION" && entry.expiry === primaryExpiry));
      const primaryFresh = primaryEntries.filter((entry) => freshTokens.has(entry.instrumentToken)).length;
      const totalFresh = entries.filter((entry) => freshTokens.has(entry.instrumentToken)).length;
      const rowBlockers: string[] = [];
      if (!primaryExpiry) rowBlockers.push("PRIMARY_EXPIRY_UNAVAILABLE");
      if (primaryFresh !== primaryEntries.length) rowBlockers.push(`PRIMARY_EVIDENCE_INCOMPLETE:${primaryFresh}/${primaryEntries.length}`);
      if (totalFresh !== entries.length) rowBlockers.push(`MULTI_EXPIRY_EVIDENCE_INCOMPLETE:${totalFresh}/${entries.length}`);
      return {
        symbol,
        primaryExpiry,
        primaryReady: primaryExpiry != null && primaryEntries.length === 3 && primaryFresh === 3,
        multiExpiryReady: entries.length > 0 && totalFresh === entries.length,
        primaryExpectedTokenCount: primaryEntries.length,
        primaryFreshTokenCount: primaryFresh,
        totalExpectedTokenCount: entries.length,
        totalFreshTokenCount: totalFresh,
        blockers: rowBlockers,
      };
    });

    return {
      version: "H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1",
      ready: blockers.length === 0 && rows.length === expected.length,
      expectedTokenCount: expected.length,
      freshTokenCount: rows.length,
      staleTokenCount: stale,
      missingTokenCount: missing.length,
      rows,
      missing,
      symbolReadiness,
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
