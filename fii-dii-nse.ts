import type {
  NseParticipantDerivativeRow,
  NseParticipantReportKind,
} from "./fii-dii-store.js";

export interface NseFiiDiiRow {
  category?: string;
  date?: string;
  buyValue?: string | number;
  sellValue?: string | number;
  netValue?: string | number;
  [key: string]: unknown;
}

export interface NormalizedFiiDiiCash {
  date: string;
  source: "NSE_FII_DII";
  sourceUrl: string;
  fetchedAt: string;
  fii: { buy: number; sell: number; net: number };
  dii: { buy: number; sell: number; net: number };
}

export const NSE_FII_DII_URL = "https://www.nseindia.com/api/fiidiiTradeReact";
export const NSE_FII_DII_REPORT_URL = "https://www.nseindia.com/reports/fii-dii";
export const NSE_PARTICIPANT_REPORT_BASE_URL = "https://nsearchives.nseindia.com/content/nsccl";
export const NSE_DERIVATIVES_REPORT_URL = "https://www.nseindia.com/all-reports-derivatives";

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const PARTICIPANT_HEADERS = [
  "client type",
  "future index long",
  "future index short",
  "future stock long",
  "future stock short",
  "option index call long",
  "option index put long",
  "option index call short",
  "option index put short",
  "option stock call long",
  "option stock put long",
  "option stock call short",
  "option stock put short",
  "total long contracts",
  "total short contracts",
] as const;

function finiteNumber(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new Error(`INVALID_${label}`);
  return n;
}

function contractCount(value: unknown, label: string): number {
  const n = finiteNumber(value, label);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`INVALID_${label}`);
  return n;
}

export function normalizeNseDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  const named = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].toUpperCase()];
    if (!month) throw new Error("INVALID_NSE_FII_DII_DATE");
    return `${named[3]}-${month}-${named[1]}`;
  }
  throw new Error("INVALID_NSE_FII_DII_DATE");
}

export function assertNseFiiDiiFreshness(dataDate: string, expectedTradingDate: string): void {
  const actual = normalizeNseDate(dataDate);
  const expected = normalizeNseDate(expectedTradingDate);
  if (actual !== expected) {
    throw new Error(`STALE_NSE_FII_DII_DATE:${actual}:EXPECTED:${expected}`);
  }
}

function categoryOf(row: NseFiiDiiRow): string {
  return String(row.category ?? row.Category ?? row.clientType ?? row.clienttype ?? "").toUpperCase();
}

function rowDate(row: NseFiiDiiRow): string {
  return normalizeNseDate(row.date ?? row.Date ?? row.tradeDate ?? row.tradedate);
}

function value(row: NseFiiDiiRow, names: string[], label: string): number {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return finiteNumber(row[name], label);
  }
  throw new Error(`MISSING_${label}`);
}

export function parseNseFiiDiiResponse(rows: unknown, fetchedAt = new Date().toISOString()): NormalizedFiiDiiCash {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("EMPTY_NSE_FII_DII_RESPONSE");
  const typed = rows as NseFiiDiiRow[];
  const fii = typed.find((r) => /FII|FPI/.test(categoryOf(r)));
  const dii = typed.find((r) => /DII/.test(categoryOf(r)));
  if (!fii) throw new Error("NSE_FII_ROW_MISSING");
  if (!dii) throw new Error("NSE_DII_ROW_MISSING");
  const fiiDate = rowDate(fii);
  const diiDate = rowDate(dii);
  if (fiiDate !== diiDate) throw new Error("NSE_FII_DII_DATE_MISMATCH");

  const fiiBuy = value(fii, ["buyValue", "buyvalue", "buy", "Buy Value", "buy_value"], "FII_BUY");
  const fiiSell = value(fii, ["sellValue", "sellvalue", "sell", "Sell Value", "sell_value"], "FII_SELL");
  const diiBuy = value(dii, ["buyValue", "buyvalue", "buy", "Buy Value", "buy_value"], "DII_BUY");
  const diiSell = value(dii, ["sellValue", "sellvalue", "sell", "Sell Value", "sell_value"], "DII_SELL");

  return {
    date: fiiDate,
    source: "NSE_FII_DII",
    sourceUrl: NSE_FII_DII_URL,
    fetchedAt,
    fii: { buy: fiiBuy, sell: fiiSell, net: fiiBuy - fiiSell },
    dii: { buy: diiBuy, sell: diiSell, net: diiBuy - diiSell },
  };
}

function baseHeaders(): Record<string, string> {
  return {
    accept: "application/json,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: NSE_FII_DII_REPORT_URL,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  };
}

function participantHeaders(): Record<string, string> {
  return {
    accept: "text/csv,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: NSE_DERIVATIVES_REPORT_URL,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  };
}

function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  const raw = setCookies.length > 0 ? setCookies : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  return raw
    .map((entry) => entry.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

export async function fetchNseFiiDii(
  fetchImpl: typeof fetch = fetch,
  expectedTradingDate?: string,
): Promise<NormalizedFiiDiiCash> {
  let cookie = "";
  try {
    const warmup = await fetchImpl(NSE_FII_DII_REPORT_URL, { headers: baseHeaders() });
    if (warmup.ok) cookie = cookiesFrom(warmup);
  } catch {
    // Warm-up is best-effort; the API request below remains the authoritative attempt.
  }

  const headers = baseHeaders();
  if (cookie) headers.cookie = cookie;
  const response = await fetchImpl(NSE_FII_DII_URL, { headers });
  if (!response.ok) throw new Error(`NSE_FII_DII_HTTP_${response.status}`);
  const normalized = parseNseFiiDiiResponse(await response.json());
  if (expectedTradingDate) assertNseFiiDiiFreshness(normalized.date, expectedTradingDate);
  return normalized;
}

function normalizeCsvHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (quoted) throw new Error("NSE_PARTICIPANT_CSV_UNTERMINATED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ""));
}

function participantCategory(value: string): NseParticipantDerivativeRow["participant"] | "TOTAL" {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CLIENT") return "CLIENT";
  if (normalized === "DII") return "DII";
  if (normalized === "FII") return "FII";
  if (normalized === "PRO") return "PRO";
  if (normalized === "TOTAL") return "TOTAL";
  throw new Error(`NSE_PARTICIPANT_CATEGORY_UNEXPECTED:${normalized || "EMPTY"}`);
}

export function nseParticipantReportUrl(reportKind: NseParticipantReportKind, tradeDate: string): string {
  if (reportKind !== "OI" && reportKind !== "VOLUME") throw new Error("NSE_PARTICIPANT_REPORT_KIND_INVALID");
  const iso = normalizeNseDate(tradeDate);
  const compact = `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
  const stem = reportKind === "OI" ? "fao_participant_oi" : "fao_participant_vol";
  return `${NSE_PARTICIPANT_REPORT_BASE_URL}/${stem}_${compact}.csv`;
}

export function parseNseParticipantDerivativesCsv(
  csv: string,
  reportKind: NseParticipantReportKind,
  tradeDate: string,
  sourceUrl: string,
  fetchedAt = new Date().toISOString(),
): NseParticipantDerivativeRow[] {
  if (!csv.trim()) throw new Error("NSE_PARTICIPANT_CSV_EMPTY");
  const rows = parseCsvRows(csv);
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.slice(0, PARTICIPANT_HEADERS.length).map(normalizeCsvHeader);
    return normalized.length === PARTICIPANT_HEADERS.length
      && PARTICIPANT_HEADERS.every((expected, index) => normalized[index] === expected);
  });
  if (headerIndex < 0) throw new Error("NSE_PARTICIPANT_CSV_HEADER_MISMATCH");

  const normalizedDate = normalizeNseDate(tradeDate);
  const participants = new Map<NseParticipantDerivativeRow["participant"], NseParticipantDerivativeRow>();

  for (const csvRow of rows.slice(headerIndex + 1)) {
    const first = csvRow[0]?.trim() ?? "";
    if (!first) continue;
    const participant = participantCategory(first);
    if (participant === "TOTAL") continue;
    if (participants.has(participant)) throw new Error(`NSE_PARTICIPANT_DUPLICATE_CATEGORY:${participant}`);
    if (csvRow.length < PARTICIPANT_HEADERS.length) throw new Error(`NSE_PARTICIPANT_CSV_ROW_SHORT:${participant}`);

    const count = (index: number, label: string) => contractCount(csvRow[index], `NSE_PARTICIPANT_${label}`);
    participants.set(participant, {
      tradeDate: normalizedDate,
      reportKind,
      participant,
      sourceUrl,
      fetchedAt,
      futureIndexLong: count(1, "FUTURE_INDEX_LONG"),
      futureIndexShort: count(2, "FUTURE_INDEX_SHORT"),
      futureStockLong: count(3, "FUTURE_STOCK_LONG"),
      futureStockShort: count(4, "FUTURE_STOCK_SHORT"),
      optionIndexCallLong: count(5, "OPTION_INDEX_CALL_LONG"),
      optionIndexPutLong: count(6, "OPTION_INDEX_PUT_LONG"),
      optionIndexCallShort: count(7, "OPTION_INDEX_CALL_SHORT"),
      optionIndexPutShort: count(8, "OPTION_INDEX_PUT_SHORT"),
      optionStockCallLong: count(9, "OPTION_STOCK_CALL_LONG"),
      optionStockPutLong: count(10, "OPTION_STOCK_PUT_LONG"),
      optionStockCallShort: count(11, "OPTION_STOCK_CALL_SHORT"),
      optionStockPutShort: count(12, "OPTION_STOCK_PUT_SHORT"),
      totalLongContracts: count(13, "TOTAL_LONG_CONTRACTS"),
      totalShortContracts: count(14, "TOTAL_SHORT_CONTRACTS"),
    });
  }

  const required: NseParticipantDerivativeRow["participant"][] = ["CLIENT", "DII", "FII", "PRO"];
  const missing = required.filter((participant) => !participants.has(participant));
  if (missing.length) throw new Error(`NSE_PARTICIPANT_CATEGORIES_MISSING:${missing.join(",")}`);
  return required.map((participant) => participants.get(participant)!);
}

export type NseParticipantFetchStatus = "VERIFIED" | "NOT_PUBLISHED_YET" | "FETCH_FAILED";

export interface NseParticipantFetchResult {
  rows: NseParticipantDerivativeRow[];
  attempts: number;
}

export interface NseParticipantRetryOptions {
  retryCount?: number;
  baseDelayMs?: number;
}

export function classifyNseParticipantFetchFailure(error: unknown): NseParticipantFetchStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/NSE_PARTICIPANT_(OI|VOLUME)_HTTP_404/.test(message)) return "NOT_PUBLISHED_YET";
  return "FETCH_FAILED";
}

function shouldRetryParticipantFetch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/NSE_PARTICIPANT_(OI|VOLUME)_HTTP_404/.test(message)) return false;
  if (/NSE_PARTICIPANT_(OI|VOLUME)_HTTP_(429|5\d\d)/.test(message)) return true;
  if (/NSE_PARTICIPANT_(OI|VOLUME)_NON_CSV_RESPONSE/.test(message)) return true;
  if (/NSE_PARTICIPANT_FETCH_NETWORK_ERROR/.test(message)) return true;
  return false;
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function fetchNseParticipantDerivatives(
  reportKind: NseParticipantReportKind,
  tradeDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NseParticipantDerivativeRow[]> {
  const sourceUrl = nseParticipantReportUrl(reportKind, tradeDate);
  let response: Response;
  try {
    response = await fetchImpl(sourceUrl, { headers: participantHeaders() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`NSE_PARTICIPANT_FETCH_NETWORK_ERROR:${reportKind}:${detail}`);
  }
  if (!response.ok) throw new Error(`NSE_PARTICIPANT_${reportKind}_HTTP_${response.status}`);
  const csv = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html") || /^\s*</.test(csv)) {
    throw new Error(`NSE_PARTICIPANT_${reportKind}_NON_CSV_RESPONSE`);
  }
  return parseNseParticipantDerivativesCsv(csv, reportKind, tradeDate, sourceUrl);
}

export async function fetchNseParticipantDerivativesWithRetry(
  reportKind: NseParticipantReportKind,
  tradeDate: string,
  options: NseParticipantRetryOptions = {},
  fetchImpl: typeof fetch = fetch,
  sleepImpl: (ms: number) => Promise<void> = sleepMs,
): Promise<NseParticipantFetchResult> {
  const retryCount = Number.isSafeInteger(options.retryCount) && Number(options.retryCount) >= 0
    ? Number(options.retryCount)
    : 2;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) && Number(options.baseDelayMs) >= 0
    ? Number(options.baseDelayMs)
    : 750;

  let lastError: unknown = new Error(`NSE_PARTICIPANT_${reportKind}_FETCH_FAILED`);
  for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
    try {
      const rows = await fetchNseParticipantDerivatives(reportKind, tradeDate, fetchImpl);
      return { rows, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt > retryCount || !shouldRetryParticipantFetch(error)) throw error;
      await sleepImpl(baseDelayMs * attempt);
    }
  }
  throw lastError;
}
