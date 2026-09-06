import { CANONICAL_SEVEN_INDEX_SCOPE, type CanonicalSevenIndexId } from "./canonical-seven-index-intelligence-freeze.ts";
import { SEVEN_INDEX_OFFICIAL_PAGE_NAMES } from "./canonical-seven-index-live-source-probe.ts";

export const CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1 = "CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1" as const;
export const OFFICIAL_NSE_ALL_INDICES_URL = "https://www.nseindia.com/api/allIndices" as const;
const NSE_HOME = "https://www.nseindia.com/";

export const SEVEN_INDEX_NSE_API_NAMES: Record<CanonicalSevenIndexId, string> = {
  NIFTY_50: "NIFTY 50",
  NIFTY_NEXT_50: "NIFTY NEXT 50",
  NIFTY_100: "NIFTY 100",
  NIFTY_200: "NIFTY 200",
  NIFTY_500: "NIFTY 500",
  NIFTY_MIDCAP_150: "NIFTY MIDCAP 150",
  NIFTY_SMALLCAP_250: "NIFTY SMALLCAP 250",
};

export interface SevenIndexMarketValueRow {
  indexId: CanonicalSevenIndexId;
  officialName: string;
  nseApiName: string;
  sourceUrl: typeof OFFICIAL_NSE_ALL_INDICES_URL;
  ltp: number;
  change: number;
  changePct: number;
  previousClose: number;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  fetchedAt: string;
}

export interface SevenIndexMarketValueResult {
  version: typeof CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1;
  ready: boolean;
  rows: SevenIndexMarketValueRow[];
  blockers: string[];
  readOnly: true;
  contextOnly: true;
  parsesMarketValues: true;
  calculatesWeightedBreadth: false;
  grantsDirectionalSupport: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  failClosed: true;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

export function parseOfficialNseAllIndicesPayload(payload: unknown, fetchedAt = new Date().toISOString()): SevenIndexMarketValueResult {
  const blockers: string[] = [];
  const rows: SevenIndexMarketValueRow[] = [];
  const data = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : null;
  if (!data) blockers.push("SEVEN_INDEX_ALL_INDICES_DATA_MISSING");

  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) {
    const apiName = SEVEN_INDEX_NSE_API_NAMES[indexId];
    const matches = (data ?? []).filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).index ?? "").trim().toUpperCase() === apiName);
    if (matches.length !== 1) {
      blockers.push(`SEVEN_INDEX_API_IDENTITY_COUNT:${indexId}:${matches.length}`);
      continue;
    }
    const raw = matches[0] as Record<string, unknown>;
    const ltp = numberOrNull(raw.last);
    const change = numberOrNull(raw.variation);
    const changePct = numberOrNull(raw.percentChange);
    const previousClose = numberOrNull(raw.previousClose);
    if (ltp === null || change === null || changePct === null || previousClose === null || ltp <= 0 || previousClose <= 0) {
      blockers.push(`SEVEN_INDEX_API_VALUE_INVALID:${indexId}`);
      continue;
    }
    const derivedChange = ltp - previousClose;
    if (Math.abs(derivedChange - change) > 0.11) {
      blockers.push(`SEVEN_INDEX_API_CHANGE_MISMATCH:${indexId}`);
      continue;
    }
    const derivedPct = (change / previousClose) * 100;
    if (Math.abs(derivedPct - changePct) > 0.08) {
      blockers.push(`SEVEN_INDEX_API_PERCENT_MISMATCH:${indexId}`);
      continue;
    }
    rows.push({
      indexId,
      officialName: SEVEN_INDEX_OFFICIAL_PAGE_NAMES[indexId],
      nseApiName: apiName,
      sourceUrl: OFFICIAL_NSE_ALL_INDICES_URL,
      ltp,
      change,
      changePct,
      previousClose,
      advances: nonNegativeIntegerOrNull(raw.advances),
      declines: nonNegativeIntegerOrNull(raw.declines),
      unchanged: nonNegativeIntegerOrNull(raw.unchanged),
      fetchedAt,
    });
  }

  const uniqueIndexIds = new Set(rows.map((row) => row.indexId)).size;
  const distinctLtps = new Set(rows.map((row) => row.ltp.toFixed(2))).size;
  if (rows.length === CANONICAL_SEVEN_INDEX_SCOPE.length && uniqueIndexIds !== CANONICAL_SEVEN_INDEX_SCOPE.length) {
    blockers.push(`SEVEN_INDEX_API_DUPLICATE_IDENTITY:${uniqueIndexIds}`);
  }
  if (rows.length === CANONICAL_SEVEN_INDEX_SCOPE.length && distinctLtps < 5) {
    blockers.push(`SEVEN_INDEX_API_VALUES_NOT_DISTINCT:${distinctLtps}`);
  }

  return {
    version: CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1,
    ready: blockers.length === 0 && rows.length === CANONICAL_SEVEN_INDEX_SCOPE.length,
    rows: blockers.length === 0 ? rows : [],
    blockers: [...new Set(blockers)],
    readOnly: true,
    contextOnly: true,
    parsesMarketValues: true,
    calculatesWeightedBreadth: false,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}

const COMMON_HEADERS = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://www.nseindia.com/market-data/live-market-indices",
};

function cookiesFromResponse(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (raw.length) return raw.map((entry) => entry.split(";", 1)[0]).join("; ");
  const one = response.headers.get("set-cookie");
  return one ? one.split(/,(?=[^;,]+=)/g).map((entry) => entry.split(";", 1)[0]).join("; ") : "";
}

async function fetchPayload(fetchImpl: typeof fetch, cookie = ""): Promise<unknown> {
  const response = await fetchImpl(OFFICIAL_NSE_ALL_INDICES_URL, {
    headers: { ...COMMON_HEADERS, ...(cookie ? { cookie } : {}) },
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

export async function fetchOfficialSevenIndexMarketValues(fetchImpl: typeof fetch = fetch): Promise<SevenIndexMarketValueResult> {
  const fetchedAt = new Date().toISOString();
  let firstError = "";
  try {
    const direct = parseOfficialNseAllIndicesPayload(await fetchPayload(fetchImpl), fetchedAt);
    if (direct.ready) return direct;
    firstError = direct.blockers.join("|");
  } catch (error) {
    firstError = error instanceof Error ? error.message : String(error);
  }

  try {
    const home = await fetchImpl(NSE_HOME, {
      headers: { ...COMMON_HEADERS, accept: "text/html,application/xhtml+xml" },
    });
    if (!home.ok) throw new Error(`BOOTSTRAP_HTTP_${home.status}`);
    const cookie = cookiesFromResponse(home);
    const retried = parseOfficialNseAllIndicesPayload(await fetchPayload(fetchImpl, cookie), fetchedAt);
    if (retried.ready) return retried;
    return { ...retried, blockers: [...new Set([`SEVEN_INDEX_DIRECT_ATTEMPT_FAILED:${firstError}`, ...retried.blockers])] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      version: CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1,
      ready: false,
      rows: [],
      blockers: [`SEVEN_INDEX_LIVE_FETCH_FAILED:${firstError}:${message}`],
      readOnly: true,
      contextOnly: true,
      parsesMarketValues: true,
      calculatesWeightedBreadth: false,
      grantsDirectionalSupport: false,
      affectsVerdict: false,
      affectsCandidate: false,
      affectsTelegram: false,
      affectsExecution: false,
      failClosed: true,
    };
  }
}
