import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";

export interface H1KiteLiveInstrumentMasterRequest {
  apiKey: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface H1KiteLiveInstrumentMasterResult {
  version: "H1_KITE_LIVE_INSTRUMENT_MASTER_ADAPTER_V1";
  ready: boolean;
  rows: KiteInstrumentMasterRow[];
  blockers: string[];
  source: "KITE_REST_INSTRUMENT_MASTER_METADATA_ONLY";
  immediateMarketDataSource: "KITE_WEBSOCKET_ONLY";
  credentialsExposed: false;
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function result(ready: boolean, rows: KiteInstrumentMasterRow[], blockers: string[]): H1KiteLiveInstrumentMasterResult {
  return {
    version: "H1_KITE_LIVE_INSTRUMENT_MASTER_ADAPTER_V1",
    ready,
    rows: ready ? rows : [],
    blockers: [...new Set(blockers)],
    source: "KITE_REST_INSTRUMENT_MASTER_METADATA_ONLY",
    immediateMarketDataSource: "KITE_WEBSOCKET_ONLY",
    credentialsExposed: false,
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("KITE_INSTRUMENT_MASTER_CSV_UNTERMINATED_QUOTE");
  out.push(field);
  return out;
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function optionalNumber(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseKiteInstrumentMasterCsv(csv: string): KiteInstrumentMasterRow[] {
  if (!csv?.trim()) throw new Error("KITE_INSTRUMENT_MASTER_EMPTY");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error("KITE_INSTRUMENT_MASTER_NO_DATA_ROWS");

  const header = parseCsvLine(lines[0]).map((x) => x.trim().toLowerCase());
  const required = ["instrument_token", "tradingsymbol", "name", "expiry", "strike", "instrument_type", "segment", "exchange"];
  const index = new Map(header.map((name, i) => [name, i]));
  for (const key of required) {
    if (!index.has(key)) throw new Error(`KITE_INSTRUMENT_MASTER_HEADER_MISSING:${key}`);
  }

  const rows: KiteInstrumentMasterRow[] = [];
  for (let lineNo = 1; lineNo < lines.length; lineNo += 1) {
    const fields = parseCsvLine(lines[lineNo]);
    const token = Number(fields[index.get("instrument_token")!]);
    const tradingsymbol = fields[index.get("tradingsymbol")!]?.trim() ?? "";
    if (!Number.isInteger(token) || token <= 0 || !tradingsymbol) {
      throw new Error(`KITE_INSTRUMENT_MASTER_ROW_INVALID:${lineNo + 1}`);
    }
    rows.push({
      instrument_token: token,
      tradingsymbol,
      name: optionalText(fields[index.get("name")!]),
      expiry: optionalText(fields[index.get("expiry")!]),
      strike: optionalNumber(fields[index.get("strike")!]),
      instrument_type: optionalText(fields[index.get("instrument_type")!]),
      segment: optionalText(fields[index.get("segment")!]),
      exchange: optionalText(fields[index.get("exchange")!]),
    });
  }
  if (rows.length === 0) throw new Error("KITE_INSTRUMENT_MASTER_NO_DATA_ROWS");
  return rows;
}

export async function fetchH1KiteLiveInstrumentMaster(
  request: H1KiteLiveInstrumentMasterRequest,
): Promise<H1KiteLiveInstrumentMasterResult> {
  const apiKey = request?.apiKey?.trim() ?? "";
  const accessToken = request?.accessToken?.trim() ?? "";
  if (!apiKey) return result(false, [], ["KITE_API_KEY_MISSING"]);
  if (!accessToken) return result(false, [], ["KITE_ACCESS_TOKEN_MISSING"]);

  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.kite.trade/instruments", {
      method: "GET",
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${apiKey}:${accessToken}`,
        Accept: "text/csv",
      },
    });
  } catch {
    return result(false, [], ["KITE_INSTRUMENT_MASTER_FETCH_FAILED"]);
  }

  if (!response.ok) return result(false, [], [`KITE_INSTRUMENT_MASTER_HTTP_${response.status}`]);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("text/csv") && !contentType.includes("text/plain") && !contentType.includes("application/octet-stream")) {
    return result(false, [], ["KITE_INSTRUMENT_MASTER_CONTENT_TYPE_INVALID"]);
  }

  let csv: string;
  try {
    csv = await response.text();
  } catch {
    return result(false, [], ["KITE_INSTRUMENT_MASTER_BODY_READ_FAILED"]);
  }

  try {
    const rows = parseKiteInstrumentMasterCsv(csv);
    return result(true, rows, []);
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message : "KITE_INSTRUMENT_MASTER_PARSE_FAILED";
    return result(false, [], [code]);
  }
}
