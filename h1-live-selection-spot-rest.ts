import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface H1LiveSelectionSpotRequest {
  rows: KiteInstrumentMasterRow[];
  symbols: RecorderSymbol[];
  apiKey: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface H1LiveSelectionSpotRow {
  symbol: RecorderSymbol;
  instrumentToken: number;
  exchange: string;
  tradingsymbol: string;
  ltp: number;
  fetchedAt: string;
}

export interface H1LiveSelectionSpotResult {
  version: "H1_LIVE_SELECTION_SPOT_REST_V1";
  ready: boolean;
  rows: H1LiveSelectionSpotRow[];
  blockers: string[];
  source: "KITE_REST_QUOTE_SELECTION_ONLY";
  productionImpact: "NONE";
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  activatesShadow: false;
  infersTokens: false;
  credentialsExposed: false;
  failClosed: true;
}

function base(ready: boolean, rows: H1LiveSelectionSpotRow[], blockers: string[]): H1LiveSelectionSpotResult {
  return { version:"H1_LIVE_SELECTION_SPOT_REST_V1", ready, rows: ready ? rows : [], blockers:[...new Set(blockers)], source:"KITE_REST_QUOTE_SELECTION_ONLY", productionImpact:"NONE", affectsDirection:false, affectsVerdict:false, affectsExecution:false, affectsTelegram:false, activatesShadow:false, infersTokens:false, credentialsExposed:false, failClosed:true };
}

function normalizedName(row: KiteInstrumentMasterRow): string {
  return `${row.name || ""} ${row.tradingsymbol || ""}`.toUpperCase();
}

function symbolMatches(row: KiteInstrumentMasterRow, symbol: RecorderSymbol): boolean {
  const text = normalizedName(row);
  if (symbol === "NIFTY") return text.includes("NIFTY") && !text.includes("BANKNIFTY") && !text.includes("FINNIFTY") && !text.includes("NIFTY BANK");
  if (symbol === "BANKNIFTY") return text.includes("BANKNIFTY") || text.includes("NIFTY BANK");
  return text.includes(symbol);
}

export async function fetchH1LiveSelectionSpots(request: H1LiveSelectionSpotRequest): Promise<H1LiveSelectionSpotResult> {
  const apiKey = request?.apiKey?.trim() ?? "";
  const accessToken = request?.accessToken?.trim() ?? "";
  if (!apiKey) return base(false, [], ["KITE_API_KEY_MISSING"]);
  if (!accessToken) return base(false, [], ["KITE_ACCESS_TOKEN_MISSING"]);
  if (!Array.isArray(request?.rows) || request.rows.length === 0) return base(false, [], ["KITE_INSTRUMENT_MASTER_REQUIRED"]);
  if (!Array.isArray(request?.symbols) || request.symbols.length === 0) return base(false, [], ["SYMBOLS_REQUIRED"]);

  const selected: Array<{symbol:RecorderSymbol;row:KiteInstrumentMasterRow;key:string}> = [];
  for (const symbol of [...new Set(request.symbols)]) {
    const matches = request.rows.filter((row) => symbolMatches(row, symbol) && String(row.segment || "").toUpperCase().includes("INDICES") && Number.isInteger(row.instrument_token) && !!row.exchange && !!row.tradingsymbol);
    if (matches.length !== 1) return base(false, [], [`KITE_SPOT_NOT_UNIQUE:${symbol}:${matches.length}`]);
    const row = matches[0];
    selected.push({ symbol, row, key: `${row.exchange}:${row.tradingsymbol}` });
  }

  const params = new URLSearchParams();
  for (const x of selected) params.append("i", x.key);
  let response: Response;
  try {
    response = await (request.fetchImpl ?? fetch)(`https://api.kite.trade/quote?${params.toString()}`, {
      method:"GET",
      headers:{ "X-Kite-Version":"3", Authorization:`token ${apiKey}:${accessToken}`, Accept:"application/json" },
    });
  } catch {
    return base(false, [], ["KITE_SELECTION_SPOT_FETCH_FAILED"]);
  }
  if (!response.ok) return base(false, [], [`KITE_SELECTION_SPOT_HTTP_${response.status}`]);

  let body: any;
  try { body = await response.json(); } catch { return base(false, [], ["KITE_SELECTION_SPOT_JSON_INVALID"]); }
  if (body?.status !== "success" || !body?.data || typeof body.data !== "object") return base(false, [], ["KITE_SELECTION_SPOT_BODY_INVALID"]);

  const fetchedAt = new Date().toISOString();
  const out: H1LiveSelectionSpotRow[] = [];
  for (const x of selected) {
    const quote = body.data[x.key];
    const ltp = Number(quote?.last_price);
    const token = Number(quote?.instrument_token);
    if (!(Number.isFinite(ltp) && ltp > 0)) return base(false, [], [`KITE_SELECTION_SPOT_LTP_INVALID:${x.symbol}`]);
    if (!Number.isInteger(token) || token !== x.row.instrument_token) return base(false, [], [`KITE_SELECTION_SPOT_TOKEN_MISMATCH:${x.symbol}`]);
    out.push({ symbol:x.symbol, instrumentToken:x.row.instrument_token, exchange:String(x.row.exchange), tradingsymbol:x.row.tradingsymbol, ltp, fetchedAt });
  }
  return base(true, out, []);
}
