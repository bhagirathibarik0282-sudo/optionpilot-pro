import { recordH1Snapshot, type H1IndexInput, type H1TruthVerdict } from "./h1-recorder-adapter.js";

export const H1_RUNTIME_BRIDGE_VERSION = "H1_RUNTIME_BRIDGE_V1" as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function truthFromUnknown(value: unknown): H1TruthVerdict | null {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "TRUE" || normalized === "VALID" || normalized === "GOOD") return "TRUE";
    if (normalized === "PARTIAL") return "PARTIAL";
    if (normalized === "STALE") return "STALE";
    if (normalized === "INVALID" || normalized === "FALSE" || normalized === "BAD") return "INVALID";
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of ["overallVerdict", "truthVerdict", "verdict", "status", "truthStatus", "dataQuality", "quality", "state"]) {
    const verdict = truthFromUnknown(value[key]);
    if (verdict) return verdict;
  }
  return null;
}

function looksLikeIndexMetrics(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const symbol = text(value.symbol);
  const spot = nullableFinite(value.spot ?? value.current);
  return !!symbol && spot !== null;
}

function collectMarkets(snapshot: unknown): UnknownRecord[] {
  if (Array.isArray(snapshot)) return snapshot.filter(looksLikeIndexMetrics);
  if (looksLikeIndexMetrics(snapshot)) return [snapshot];
  if (!isRecord(snapshot)) return [];
  const out: UnknownRecord[] = [];
  for (const value of Object.values(snapshot)) {
    if (looksLikeIndexMetrics(value)) out.push(value);
  }
  return out;
}

function truthForSymbol(truthSource: unknown, symbol: string): H1TruthVerdict | null {
  const direct = truthFromUnknown(truthSource);
  if (direct) return direct;
  if (!isRecord(truthSource)) return null;
  const exact = truthSource[symbol] ?? truthSource[symbol.toUpperCase()] ?? truthSource[symbol.toLowerCase()];
  return truthFromUnknown(exact);
}

function normalizePremium(raw: unknown): any | null {
  if (!isRecord(raw)) return null;
  const optionType = text(raw.optionType)?.toUpperCase();
  if (optionType !== "CE" && optionType !== "PE") return null;
  return {
    strike: finite(raw.strike),
    isAtm: raw.isAtm === true,
    expiryDate: text(raw.expiryDate),
    expiryBucket: text(raw.expiryBucket),
    optionType,
    bid: finite(raw.bid),
    ask: finite(raw.ask),
    lastPrice: finite(raw.lastPrice),
    iv: finite(raw.iv),
    oi: finite(raw.oi),
    volume: nullableFinite(raw.volume),
    quoteTimestamp: text(raw.quoteTimestamp),
    dayHigh: finite(raw.dayHigh),
    dayLow: finite(raw.dayLow),
    pdh: finite(raw.pdh),
    pdl: finite(raw.pdl),
    vega: finite(raw.vega),
    theta: finite(raw.theta),
    delta: finite(raw.delta),
    gamma: finite(raw.gamma),
  };
}

function normalizeExpiry(raw: unknown): any | null {
  if (!isRecord(raw)) return null;
  const expiry = text(raw.expiry) ?? text(raw.label) ?? text(raw.expiryBucket);
  const dateRaw = raw.expiryDate;
  if (!expiry || !dateRaw) return null;
  const expiryDate = dateRaw instanceof Date ? dateRaw : new Date(String(dateRaw));
  if (Number.isNaN(expiryDate.getTime())) return null;
  const ce = Array.isArray(raw.ceStrikes) ? raw.ceStrikes.map(normalizePremium).filter(Boolean) : [];
  const pe = Array.isArray(raw.peStrikes) ? raw.peStrikes.map(normalizePremium).filter(Boolean) : [];
  return { expiry, expiryDate, ceStrikes: ce, peStrikes: pe };
}

function normalizeFuture(raw: unknown): any | null {
  if (!isRecord(raw)) return null;
  const label = text(raw.label);
  if (label !== "Near" && label !== "Next" && label !== "Far") return null;
  return {
    label,
    expiry: text(raw.expiry) ?? "",
    ltp: finite(raw.ltp),
    oi: nullableFinite(raw.oi),
    volume: nullableFinite(raw.volume),
    basis: nullableFinite(raw.basis),
    quoteTimestamp: text(raw.quoteTimestamp),
  };
}

function normalizeIndex(raw: UnknownRecord): H1IndexInput | null {
  const symbol = text(raw.symbol);
  if (!symbol) return null;
  const expiries = Array.isArray(raw.expiries) ? raw.expiries.map(normalizeExpiry).filter(Boolean) : [];
  const futuresContracts = Array.isArray(raw.futuresContracts) ? raw.futuresContracts.map(normalizeFuture).filter(Boolean) : [];
  return {
    symbol,
    snapshotId: text(raw.snapshotId) ?? `${symbol}-${text(raw.timestamp) ?? new Date().toISOString()}`,
    exchangeTimestamp: text(raw.exchangeTimestamp),
    timestamp: text(raw.timestamp) ?? undefined,
    spot: finite(raw.spot ?? raw.current),
    atmStrike: finite(raw.atmStrike),
    vwap: finite(raw.vwap),
    pdh: finite(raw.pdh),
    pdl: finite(raw.pdl),
    pdcClose: finite(raw.pdcClose),
    dayOpen: finite(raw.dayOpen),
    dayHigh: finite(raw.dayHigh),
    dayLow: finite(raw.dayLow),
    vix: finite(raw.vix),
    vixChange: finite(raw.vixChange),
    maxPain: finite(raw.maxPain),
    pcr: nullableFinite(raw.pcr),
    volumePcr: nullableFinite(raw.volumePcr),
    futuresContracts: futuresContracts as H1IndexInput["futuresContracts"],
    expiries: expiries as H1IndexInput["expiries"],
  };
}

/**
 * Runtime bridge used only by the final server.ts hook.
 * It is intentionally structural and fail-closed:
 * - no recognized existing Truth result => no normalized H1 write;
 * - malformed market snapshot => skipped;
 * - all recorder errors stay outside the live path.
 */
export async function recordH1FromRuntimeSnapshot(
  runtimeSnapshot: unknown,
  runtimeTruth: unknown,
  calculationVersion = H1_RUNTIME_BRIDGE_VERSION,
): Promise<{ attempted: number; skipped: number }> {
  const markets = collectMarkets(runtimeSnapshot);
  let attempted = 0;
  let skipped = 0;

  for (const raw of markets) {
    const market = normalizeIndex(raw);
    if (!market) {
      skipped += 1;
      continue;
    }
    const truthVerdict = truthForSymbol(runtimeTruth, market.symbol);
    if (!truthVerdict) {
      skipped += 1;
      console.warn(`[H1] skip ${market.symbol}: existing Truth verdict could not be resolved; no fallback truth is invented.`);
      continue;
    }
    attempted += 1;
    await recordH1Snapshot({ market, truthVerdict, calculationVersion });
  }

  return { attempted, skipped };
}