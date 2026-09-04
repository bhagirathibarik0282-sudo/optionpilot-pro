import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface H1ExactLiveContractDiscoveryRequest {
  symbols: RecorderSymbol[];
  asOfDate: string;
}

export interface H1ExactLiveContractDiscoveryRow {
  symbol: RecorderSymbol;
  expiry: string;
  strikeCount: number;
  minStrike: number;
  maxStrike: number;
  ceCount: number;
  peCount: number;
}

export interface H1ExactLiveContractDiscoveryResult {
  version: "H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1";
  ready: boolean;
  rows: H1ExactLiveContractDiscoveryRow[];
  blockers: string[];
  source: "KITE_INSTRUMENT_MASTER_EXACT";
  choosesAtm: false;
  inferredTokens: false;
  productionImpact: "NONE";
  writesRailwayVariables: false;
  activatesShadow: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

function fail(blockers: string[]): H1ExactLiveContractDiscoveryResult {
  return { version: "H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", ready: false, rows: [], blockers: [...new Set(blockers)], source: "KITE_INSTRUMENT_MASTER_EXACT", choosesAtm: false, inferredTokens: false, productionImpact: "NONE", writesRailwayVariables: false, activatesShadow: false, affectsVerdict: false, affectsExecution: false, failClosed: true };
}

function symbolMatches(row: KiteInstrumentMasterRow, symbol: RecorderSymbol): boolean {
  const name = String(row.name ?? "").trim().toUpperCase();
  const ts = String(row.tradingsymbol ?? "").trim().toUpperCase();
  return name === symbol || ts.startsWith(symbol);
}

export function discoverH1ExactLiveContractUniverse(
  rows: KiteInstrumentMasterRow[],
  request: H1ExactLiveContractDiscoveryRequest,
): H1ExactLiveContractDiscoveryResult {
  if (!Array.isArray(rows) || rows.length === 0) return fail(["KITE_INSTRUMENT_MASTER_REQUIRED"]);
  if (!Array.isArray(request?.symbols) || request.symbols.length === 0) return fail(["DISCOVERY_SYMBOLS_REQUIRED"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.asOfDate)) return fail(["DISCOVERY_AS_OF_DATE_INVALID"]);

  const out: H1ExactLiveContractDiscoveryRow[] = [];
  for (const symbol of [...new Set(request.symbols)]) {
    const optionRows = rows.filter((row) => {
      const side = String(row.instrument_type ?? "").toUpperCase();
      const expiry = String(row.expiry ?? "");
      const strike = Number(row.strike);
      return symbolMatches(row, symbol) && (side === "CE" || side === "PE") && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry >= request.asOfDate && Number.isFinite(strike) && strike > 0;
    });
    if (optionRows.length === 0) return fail([`NO_NON_EXPIRED_EXACT_OPTIONS:${symbol}`]);

    const expiries = [...new Set(optionRows.map((row) => String(row.expiry)))].sort();
    for (const expiry of expiries) {
      const expiryRows = optionRows.filter((row) => row.expiry === expiry);
      const strikes = [...new Set(expiryRows.map((row) => Number(row.strike)))].sort((a, b) => a - b);
      const ceCount = expiryRows.filter((row) => String(row.instrument_type).toUpperCase() === "CE").length;
      const peCount = expiryRows.filter((row) => String(row.instrument_type).toUpperCase() === "PE").length;
      if (strikes.length === 0 || ceCount === 0 || peCount === 0) return fail([`INCOMPLETE_EXACT_OPTION_EXPIRY:${symbol}:${expiry}`]);
      out.push({ symbol, expiry, strikeCount: strikes.length, minStrike: strikes[0], maxStrike: strikes[strikes.length - 1], ceCount, peCount });
    }
  }

  return { version: "H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", ready: true, rows: out, blockers: [], source: "KITE_INSTRUMENT_MASTER_EXACT", choosesAtm: false, inferredTokens: false, productionImpact: "NONE", writesRailwayVariables: false, activatesShadow: false, affectsVerdict: false, affectsExecution: false, failClosed: true };
}
