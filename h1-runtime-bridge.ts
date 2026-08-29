import { recordH1Snapshot, type H1IndexInput, type H1TruthVerdict } from "./h1-recorder-adapter.js";
import { dbInsert } from "./db.js";

export const H1_RUNTIME_BRIDGE_VERSION = "H1_RUNTIME_BRIDGE_V1" as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * H1 recorder input still uses numeric fields for compatibility, while the DB
 * adapter already converts non-finite values to NULL. Use NaN strictly as an
 * internal missing-value sentinel across that typed boundary; never replace a
 * missing observed metric with a fabricated numeric zero.
 */
function finiteOrMissing(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function nullableFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validTimestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function minuteBucketIso(date: Date): string {
  const d = new Date(date);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
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
  const strike = nullableFinite(raw.strike);
  if ((optionType !== "CE" && optionType !== "PE") || strike === null || strike <= 0) return null;
  return {
    strike,
    isAtm: raw.isAtm === true,
    expiryDate: text(raw.expiryDate),
    expiryBucket: text(raw.expiryBucket),
    optionType,
    bid: finiteOrMissing(raw.bid),
    ask: finiteOrMissing(raw.ask),
    lastPrice: finiteOrMissing(raw.lastPrice),
    iv: finiteOrMissing(raw.iv),
    oi: finiteOrMissing(raw.oi),
    volume: nullableFinite(raw.volume),
    quoteTimestamp: validTimestamp(raw.quoteTimestamp),
    dayHigh: finiteOrMissing(raw.dayHigh),
    dayLow: finiteOrMissing(raw.dayLow),
    pdh: finiteOrMissing(raw.pdh),
    pdl: finiteOrMissing(raw.pdl),
    vega: finiteOrMissing(raw.vega),
    theta: finiteOrMissing(raw.theta),
    delta: finiteOrMissing(raw.delta),
    gamma: finiteOrMissing(raw.gamma),
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
    ltp: finiteOrMissing(raw.ltp),
    oi: nullableFinite(raw.oi),
    volume: nullableFinite(raw.volume),
    basis: nullableFinite(raw.basis),
    quoteTimestamp: validTimestamp(raw.quoteTimestamp),
  };
}

function normalizeIndex(raw: UnknownRecord): H1IndexInput | null {
  const symbol = text(raw.symbol);
  const spot = nullableFinite(raw.spot ?? raw.current);
  const timestamp = validTimestamp(raw.timestamp) ?? validTimestamp(raw.exchangeTimestamp);

  // Identity + source time are mandatory. Never synthesize a snapshot identity
  // from wall-clock time and never assign processing time to missing market data.
  if (!symbol || spot === null || !timestamp) return null;

  const expiries = Array.isArray(raw.expiries) ? raw.expiries.map(normalizeExpiry).filter(Boolean) : [];
  const futuresContracts = Array.isArray(raw.futuresContracts) ? raw.futuresContracts.map(normalizeFuture).filter(Boolean) : [];
  return {
    symbol,
    snapshotId: text(raw.snapshotId) ?? `${symbol}-${timestamp}`,
    exchangeTimestamp: validTimestamp(raw.exchangeTimestamp),
    timestamp,
    spot,
    atmStrike: finiteOrMissing(raw.atmStrike),
    vwap: finiteOrMissing(raw.vwap),
    pdh: finiteOrMissing(raw.pdh),
    pdl: finiteOrMissing(raw.pdl),
    pdcClose: finiteOrMissing(raw.pdcClose),
    dayOpen: finiteOrMissing(raw.dayOpen),
    dayHigh: finiteOrMissing(raw.dayHigh),
    dayLow: finiteOrMissing(raw.dayLow),
    vix: finiteOrMissing(raw.vix),
    vixChange: finiteOrMissing(raw.vixChange),
    maxPain: finiteOrMissing(raw.maxPain),
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
 * - missing source timestamp or malformed market identity => skipped;
 * - missing optional metrics remain missing and persist as DB NULL, never zero;
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
    if (!market || !market.timestamp) {
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
    const recordNow = new Date(market.timestamp);
    await recordH1Snapshot({ market, truthVerdict, calculationVersion, now: recordNow });
    await dbInsert("H1_TRUTH_MARKER", {
      symbol: market.symbol,
      snapshotId: market.snapshotId,
      minuteBucket: minuteBucketIso(recordNow),
      truthVerdict,
      calculationVersion,
    });
  }

  return { attempted, skipped };
}
