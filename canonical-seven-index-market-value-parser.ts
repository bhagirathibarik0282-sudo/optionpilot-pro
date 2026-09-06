import { CANONICAL_SEVEN_INDEX_SCOPE, type CanonicalSevenIndexId } from "./canonical-seven-index-intelligence-freeze.ts";
import { officialSevenIndexPageUrl, SEVEN_INDEX_OFFICIAL_PAGE_NAMES } from "./canonical-seven-index-live-source-probe.ts";

export const CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1 = "CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1" as const;

export interface SevenIndexMarketValueRow {
  indexId: CanonicalSevenIndexId;
  officialName: string;
  sourceUrl: string;
  ltp: number;
  change: number;
  changePct: number;
  previousClose: number;
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

function decodeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#37;|&percnt;/gi, "%")
    .replace(/&#43;/gi, "+")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function parseOfficialIndexMarketValueHtml(input: {
  indexId: CanonicalSevenIndexId;
  html: string;
  sourceUrl?: string;
  fetchedAt?: string;
}): { row: SevenIndexMarketValueRow | null; blocker: string | null } {
  const officialName = SEVEN_INDEX_OFFICIAL_PAGE_NAMES[input.indexId];
  const sourceUrl = input.sourceUrl ?? officialSevenIndexPageUrl(input.indexId);
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const text = decodeHtml(input.html);

  if (!text.toLowerCase().includes("index movers")) {
    return { row: null, blocker: `SEVEN_INDEX_MARKET_VALUE_PAGE_MISMATCH:${input.indexId}` };
  }

  // The official Index Movers page renders the selected index summary as
  // LTP, absolute change and percentage change before the "As on" marker.
  // Restricting extraction to that header prevents constituent-table values
  // from being mistaken for the index-level value.
  const asOnIndex = text.toLowerCase().indexOf("as on");
  if (asOnIndex < 0) {
    return { row: null, blocker: `SEVEN_INDEX_MARKET_VALUE_AS_ON_MISSING:${input.indexId}` };
  }
  const header = text.slice(0, asOnIndex);
  const triples = [...header.matchAll(/([0-9][0-9,]*\.\d{2})\s+([+-]?[0-9][0-9,]*\.\d{2})\s+([+-]?[0-9]+(?:\.\d+)?)\s*%/g)];
  if (triples.length !== 1) {
    return { row: null, blocker: `SEVEN_INDEX_MARKET_VALUE_HEADER_AMBIGUOUS:${input.indexId}:${triples.length}` };
  }

  const ltp = parseNumber(triples[0][1]);
  const change = parseNumber(triples[0][2]);
  const changePct = parseNumber(triples[0][3]);
  const previousClose = ltp - change;
  if (![ltp, change, changePct, previousClose].every(Number.isFinite) || ltp <= 0 || previousClose <= 0) {
    return { row: null, blocker: `SEVEN_INDEX_MARKET_VALUE_INVALID:${input.indexId}` };
  }

  const recomputedPct = (change / previousClose) * 100;
  if (Math.abs(recomputedPct - changePct) > 0.08) {
    return { row: null, blocker: `SEVEN_INDEX_MARKET_VALUE_ARITHMETIC_MISMATCH:${input.indexId}` };
  }

  return {
    row: { indexId: input.indexId, officialName, sourceUrl, ltp, change, changePct, previousClose, fetchedAt },
    blocker: null,
  };
}

export async function fetchOfficialSevenIndexMarketValues(fetchImpl: typeof fetch = fetch): Promise<SevenIndexMarketValueResult> {
  const rows: SevenIndexMarketValueRow[] = [];
  const blockers: string[] = [];
  const fetchedAt = new Date().toISOString();

  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) {
    const sourceUrl = officialSevenIndexPageUrl(indexId);
    try {
      const response = await fetchImpl(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) {
        blockers.push(`SEVEN_INDEX_MARKET_VALUE_HTTP_${response.status}:${indexId}`);
        continue;
      }
      const parsed = parseOfficialIndexMarketValueHtml({ indexId, html: await response.text(), sourceUrl, fetchedAt });
      if (!parsed.row || parsed.blocker) {
        blockers.push(parsed.blocker ?? `SEVEN_INDEX_MARKET_VALUE_PARSE_FAILED:${indexId}`);
        continue;
      }
      rows.push(parsed.row);
    } catch {
      blockers.push(`SEVEN_INDEX_MARKET_VALUE_FETCH_FAILED:${indexId}`);
    }
  }

  // A server-side fallback that returns the same default index page for every
  // query is not acceptable practical evidence. Require meaningful diversity.
  const distinctLtps = new Set(rows.map((row) => row.ltp.toFixed(2))).size;
  if (rows.length === CANONICAL_SEVEN_INDEX_SCOPE.length && distinctLtps < 5) {
    blockers.push(`SEVEN_INDEX_MARKET_VALUE_NOT_DISTINCT:${distinctLtps}`);
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
