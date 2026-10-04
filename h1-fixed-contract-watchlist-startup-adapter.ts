import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export const H1_FIXED_CONTRACT_WATCHLIST_ENV = "H1_FIXED_CONTRACT_WATCHLIST_JSON" as const;
export const H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS = 24 as const;

type Symbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
type Side = "CE" | "PE";

interface Request {
  symbol: Symbol;
  expiry: string;
  strike: number;
  side: Side;
}

export interface H1FixedContractWatchlistStartupResult {
  version: "H1_FIXED_CONTRACT_WATCHLIST_STARTUP_V1";
  configured: boolean;
  ready: boolean;
  requestCount: number;
  registry: KiteImmediateTokenEntry[];
  blockers: string[];
  source: "OWNER_APPROVED_JSON_PLUS_KITE_INSTRUMENT_MASTER";
  maxContracts: typeof H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS;
  readOnly: true;
  observationalOnly: true;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function result(configured: boolean, ready: boolean, requestCount: number, registry: KiteImmediateTokenEntry[], blockers: string[]): H1FixedContractWatchlistStartupResult {
  return {
    version: "H1_FIXED_CONTRACT_WATCHLIST_STARTUP_V1",
    configured,
    ready,
    requestCount,
    registry: ready ? registry.map((entry) => ({ ...entry })) : [],
    blockers: [...new Set(blockers)],
    source: "OWNER_APPROVED_JSON_PLUS_KITE_INSTRUMENT_MASTER",
    maxContracts: H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS,
    readOnly: true,
    observationalOnly: true,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function parseRequests(raw: string): Request[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("H1_FIXED_CONTRACT_WATCHLIST_JSON_INVALID"); }
  if (!Array.isArray(value) || value.length === 0) throw new Error("H1_FIXED_CONTRACT_WATCHLIST_EMPTY");
  if (value.length > H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_LIMIT_EXCEEDED:${value.length}`);

  return value.map((item, index) => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_REQUEST_INVALID:${index}`);
    const row = item as Record<string, unknown>;
    if (row.symbol !== "NIFTY" && row.symbol !== "SENSEX" && row.symbol !== "BANKNIFTY") throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_SYMBOL_INVALID:${index}`);
    if (!validDateOnly(row.expiry)) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_EXPIRY_INVALID:${index}`);
    if (typeof row.strike !== "number" || !Number.isFinite(row.strike) || row.strike <= 0) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_STRIKE_INVALID:${index}`);
    if (row.side !== "CE" && row.side !== "PE") throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_SIDE_INVALID:${index}`);
    return { symbol: row.symbol, expiry: row.expiry, strike: row.strike, side: row.side };
  });
}

function symbolMatches(row: KiteInstrumentMasterRow, symbol: Symbol): boolean {
  const text = `${row.name ?? ""} ${row.tradingsymbol ?? ""}`.trim().toUpperCase();
  if (symbol === "NIFTY") return text.includes("NIFTY") && !text.includes("BANKNIFTY") && !text.includes("FINNIFTY") && !text.includes("MIDCPNIFTY");
  return text.includes(symbol);
}

function calendarDte(asOfDate: string, expiry: string): number {
  const value = (Date.parse(`${expiry}T00:00:00.000Z`) - Date.parse(`${asOfDate}T00:00:00.000Z`)) / 86_400_000;
  return Number.isInteger(value) ? value : Number.NaN;
}

function bankNiftyMonthlyExpiry(rows: KiteInstrumentMasterRow[], expiry: string): boolean {
  const month = expiry.slice(0, 7);
  const expiries = rows
    .filter((row) => symbolMatches(row, "BANKNIFTY") && (row.instrument_type === "CE" || row.instrument_type === "PE"))
    .map((row) => String(row.expiry ?? ""))
    .filter((value) => value.startsWith(`${month}-`))
    .sort();
  return expiries.length > 0 && expiry === expiries[expiries.length - 1];
}

/** Resolves only explicit, bounded research contracts. It never infers strikes or expiries. */
export function prepareH1FixedContractWatchlistStartup(
  rows: KiteInstrumentMasterRow[],
  asOfDate: string,
  rawConfig: string | null | undefined,
): H1FixedContractWatchlistStartupResult {
  const raw = rawConfig?.trim() ?? "";
  if (!raw) return result(false, false, 0, [], ["H1_FIXED_CONTRACT_WATCHLIST_NOT_CONFIGURED"]);
  if (!validDateOnly(asOfDate)) return result(true, false, 0, [], ["H1_FIXED_CONTRACT_WATCHLIST_AS_OF_DATE_INVALID"]);
  if (!Array.isArray(rows) || rows.length === 0) return result(true, false, 0, [], ["KITE_INSTRUMENT_MASTER_EMPTY"]);

  try {
    const requests = parseRequests(raw);
    const seen = new Set<string>();
    const entries: KiteImmediateTokenEntry[] = [];
    for (const request of requests) {
      const key = `${request.symbol}|${request.expiry}|${request.strike}|${request.side}`;
      if (seen.has(key)) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_DUPLICATE:${key}`);
      seen.add(key);

      const dte = calendarDte(asOfDate, request.expiry);
      if (request.symbol === "BANKNIFTY") {
        if (!bankNiftyMonthlyExpiry(rows, request.expiry)) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_BANKNIFTY_MONTHLY_REQUIRED:${request.expiry}`);
      } else if (!Number.isInteger(dte) || dte < 0 || dte > 4) {
        throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_DTE_OUT_OF_RANGE:${key}:${Number.isFinite(dte) ? dte : "INVALID"}`);
      }

      const matches = rows.filter((row) =>
        symbolMatches(row, request.symbol) &&
        String(row.expiry ?? "") === request.expiry &&
        Number(row.strike) === request.strike &&
        String(row.instrument_type ?? "").toUpperCase() === request.side &&
        Number.isInteger(row.instrument_token) && row.instrument_token > 0,
      );
      if (matches.length !== 1) throw new Error(`H1_FIXED_CONTRACT_WATCHLIST_NOT_UNIQUE:${key}:${matches.length}`);
      const match = matches[0];
      entries.push({
        instrumentToken: match.instrument_token,
        symbol: request.symbol,
        role: "OPTION",
        instrumentLabel: match.tradingsymbol,
        expiry: request.expiry,
        strike: request.strike,
        optionSide: request.side,
      });
    }
    return result(true, true, requests.length, entries, []);
  } catch (error) {
    return result(true, false, 0, [], [error instanceof Error ? error.message : "H1_FIXED_CONTRACT_WATCHLIST_UNKNOWN"]);
  }
}
