import type {
  DataQualityStatus,
  ResearchIndexCode,
  ResearchIndexDailyRecord,
} from "./research-index-types";

export interface ResearchIndexHealth {
  overall: DataQualityStatus;
  latestTradeDate: string | null;
  coverage: Record<ResearchIndexCode, DataQualityStatus>;
  missing: ResearchIndexCode[];
  stale: ResearchIndexCode[];
  invalid: ResearchIndexCode[];
  warnings: string[];
}

export const RESEARCH_INDEX_CODES: ResearchIndexCode[] = [
  "NIFTY50",
  "NIFTY100",
  "NIFTY200",
  "NIFTY500",
  "NEXT50",
  "MIDCAP150",
  "SMALLCAP250",
];

const CORE_CODES = new Set<ResearchIndexCode>(["NIFTY50", "NIFTY500"]);

function newest(records: ResearchIndexDailyRecord[]): ResearchIndexDailyRecord | null {
  return [...records].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0] ?? null;
}

export function evaluateResearchIndexHealth(
  rowsByIndex: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>>,
): ResearchIndexHealth {
  const coverage = {} as Record<ResearchIndexCode, DataQualityStatus>;
  const missing: ResearchIndexCode[] = [];
  const stale: ResearchIndexCode[] = [];
  const invalid: ResearchIndexCode[] = [];
  const warnings: string[] = [];

  let latestTradeDate: string | null = null;
  const latestByCode = new Map<ResearchIndexCode, ResearchIndexDailyRecord>();

  for (const code of RESEARCH_INDEX_CODES) {
    const latest = newest(rowsByIndex[code] ?? []);
    if (!latest) {
      coverage[code] = "INVALID";
      missing.push(code);
      continue;
    }
    latestByCode.set(code, latest);
    if (!latestTradeDate || latest.tradeDate > latestTradeDate) latestTradeDate = latest.tradeDate;
  }

  for (const code of RESEARCH_INDEX_CODES) {
    const latest = latestByCode.get(code);
    if (!latest) continue;

    if (latest.validationStatus === "INVALID") {
      coverage[code] = "INVALID";
      invalid.push(code);
      continue;
    }

    const dateMismatch = latestTradeDate !== null && latest.tradeDate !== latestTradeDate;
    const freshnessStale = latest.freshnessStatus === "STALE";

    if (dateMismatch || freshnessStale) {
      coverage[code] = "STALE";
      stale.push(code);
      if (dateMismatch) warnings.push(`${code} latest date ${latest.tradeDate} != ${latestTradeDate}`);
      continue;
    }

    if (latest.validationStatus === "PARTIAL" || latest.freshnessStatus === "UNKNOWN") {
      coverage[code] = "PARTIAL";
      continue;
    }

    coverage[code] = "GOOD";
  }

  const coreFailure = RESEARCH_INDEX_CODES.some(
    (code) => CORE_CODES.has(code) && (coverage[code] === "INVALID" || coverage[code] === "STALE"),
  );
  const unusableCount = RESEARCH_INDEX_CODES.filter(
    (code) => coverage[code] === "INVALID" || coverage[code] === "STALE",
  ).length;

  let overall: DataQualityStatus;
  if (coreFailure || unusableCount >= 4) overall = "INVALID";
  else if (unusableCount > 0) overall = "STALE";
  else if (RESEARCH_INDEX_CODES.some((code) => coverage[code] === "PARTIAL")) overall = "PARTIAL";
  else overall = "GOOD";

  return { overall, latestTradeDate, coverage, missing, stale, invalid, warnings };
}
