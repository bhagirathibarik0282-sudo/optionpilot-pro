import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type KiteInstrumentMasterRow = {
  instrument_token: number;
  tradingsymbol: string;
  name?: string | null;
  expiry?: string | null;
  strike?: number | null;
  instrument_type?: string | null;
  segment?: string | null;
  exchange?: string | null;
};

export type ImmediateRegistryBuildRequest = {
  symbols: RecorderSymbol[];
  expiryBySymbol?: Partial<Record<RecorderSymbol, string>>;
  expiriesBySymbol?: Partial<Record<RecorderSymbol, string[]>>;
  strikesBySymbol: Partial<Record<RecorderSymbol, number[]>>;
};

function normalizedName(row: KiteInstrumentMasterRow): string {
  return `${row.name || ""} ${row.tradingsymbol || ""}`.toUpperCase();
}

function symbolMatches(row: KiteInstrumentMasterRow, symbol: RecorderSymbol): boolean {
  const text = normalizedName(row);
  if (symbol === "NIFTY") return text.includes("NIFTY") && !text.includes("BANKNIFTY") && !text.includes("FINNIFTY");
  return text.includes(symbol);
}

function findUnique(rows: KiteInstrumentMasterRow[], predicate: (row: KiteInstrumentMasterRow) => boolean, error: string): KiteInstrumentMasterRow {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) throw new Error(`${error}:${matches.length}`);
  return matches[0];
}

function requestedExpiries(request: ImmediateRegistryBuildRequest, symbol: RecorderSymbol): string[] {
  const explicit = request.expiriesBySymbol?.[symbol];
  const legacy = request.expiryBySymbol?.[symbol];
  const raw = explicit ?? (legacy ? [legacy] : []);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`KITE_IMMEDIATE_EXPIRIES_MISSING:${symbol}`);
  const expiries = raw.map((x) => String(x || "").trim());
  if (expiries.some((x) => !x)) throw new Error(`KITE_IMMEDIATE_EXPIRY_INVALID:${symbol}`);
  if (new Set(expiries).size !== expiries.length) throw new Error(`KITE_IMMEDIATE_EXPIRY_DUPLICATE:${symbol}`);
  return expiries;
}

export function buildKiteImmediateTokenRegistryFromMaster(
  rows: KiteInstrumentMasterRow[],
  request: ImmediateRegistryBuildRequest,
): KiteImmediateTokenRegistry {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("KITE_INSTRUMENT_MASTER_EMPTY");
  if (!Array.isArray(request.symbols) || request.symbols.length === 0) throw new Error("KITE_IMMEDIATE_SYMBOLS_EMPTY");
  const entries: KiteImmediateTokenEntry[] = [];

  for (const symbol of request.symbols) {
    const expiries = requestedExpiries(request, symbol);
    const strikes = request.strikesBySymbol[symbol] ?? [];
    if (!strikes.length) throw new Error(`KITE_IMMEDIATE_UNIVERSE_MISSING:${symbol}`);

    const spot = findUnique(rows, (row) => symbolMatches(row, symbol) && String(row.segment || "").toUpperCase().includes("INDICES"), `KITE_SPOT_NOT_UNIQUE:${symbol}`);
    entries.push({ instrumentToken: spot.instrument_token, symbol, role: "SPOT", instrumentLabel: spot.tradingsymbol || symbol });

    const futuresCandidates = rows.filter((row) => symbolMatches(row, symbol)
      && String(row.instrument_type || "").toUpperCase() === "FUT"
      && Number.isInteger(row.instrument_token));
    if (!futuresCandidates.length) throw new Error(`KITE_FUTURE_NOT_FOUND:${symbol}`);
    futuresCandidates.sort((a, b) => String(a.expiry || "").localeCompare(String(b.expiry || "")));
    const future = futuresCandidates[0];
    entries.push({ instrumentToken: future.instrument_token, symbol, role: "FUTURE", instrumentLabel: future.tradingsymbol });

    for (const expiry of expiries) {
      for (const strike of strikes) {
        for (const side of ["CE", "PE"] as const) {
          const option = findUnique(rows, (row) => symbolMatches(row, symbol)
            && String(row.instrument_type || "").toUpperCase() === side
            && String(row.expiry || "") === expiry
            && Number(row.strike) === strike,
          `KITE_OPTION_NOT_UNIQUE:${symbol}:${expiry}:${strike}:${side}`);
          entries.push({
            instrumentToken: option.instrument_token,
            symbol,
            role: "OPTION",
            instrumentLabel: option.tradingsymbol,
            expiry,
            strike,
            optionSide: side,
          });
        }
      }
    }
  }

  const vix = findUnique(rows, (row) => normalizedName(row).includes("INDIA VIX") && String(row.segment || "").toUpperCase().includes("INDICES"), "KITE_INDIA_VIX_NOT_UNIQUE");
  // VIX is market-wide context. Attach it to NIFTY when present, otherwise first requested symbol.
  const vixSymbol = request.symbols.includes("NIFTY") ? "NIFTY" : request.symbols[0];
  entries.push({ instrumentToken: vix.instrument_token, symbol: vixSymbol, role: "INDIA_VIX", instrumentLabel: vix.tradingsymbol || "INDIA VIX" });

  return new KiteImmediateTokenRegistry(entries);
}
