export const CANONICAL_SEVEN_INDEX_INTELLIGENCE_FREEZE_V1 = "CANONICAL_SEVEN_INDEX_INTELLIGENCE_FREEZE_V1" as const;
export const OFFICIAL_NSE_INDICES_SOURCE = "https://www.niftyindices.com/" as const;

export const CANONICAL_SEVEN_INDEX_SCOPE = [
  "NIFTY_50",
  "NIFTY_NEXT_50",
  "NIFTY_100",
  "NIFTY_200",
  "NIFTY_500",
  "NIFTY_MIDCAP_150",
  "NIFTY_SMALLCAP_250",
] as const;

export type CanonicalSevenIndexId = (typeof CANONICAL_SEVEN_INDEX_SCOPE)[number];

export interface SevenIndexEvidenceRow {
  indexId: CanonicalSevenIndexId;
  sourceUrl: string;
  sourceDate: string;
  sourceHash: string;
  ltp: number;
  previousClose: number;
  returnPct: number;
  weightedBreadthPct: number;
  sectorBreadthPct: number;
}

export interface SevenIndexIntelligenceFreezeResult {
  version: typeof CANONICAL_SEVEN_INDEX_INTELLIGENCE_FREEZE_V1;
  ready: boolean;
  scope: readonly CanonicalSevenIndexId[];
  rows: SevenIndexEvidenceRow[];
  blockers: string[];
  readOnly: true;
  contextOnly: true;
  weightedConstituentContributionRequired: true;
  equalCountBreadthForbidden: true;
  aiExplanationOnly: true;
  grantsDirectionalSupport: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{64}$/i;

function sourceIsOfficial(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "niftyindices.com" || parsed.hostname.endsWith(".niftyindices.com"));
  } catch {
    return false;
  }
}

export function freezeSevenIndexIntelligence(input: {
  rows: SevenIndexEvidenceRow[];
  asOfDate: string;
  maxStaleCalendarDays: number;
}): SevenIndexIntelligenceFreezeResult {
  const blockers: string[] = [];
  const fail = (): SevenIndexIntelligenceFreezeResult => ({
    version: CANONICAL_SEVEN_INDEX_INTELLIGENCE_FREEZE_V1,
    ready: false,
    scope: CANONICAL_SEVEN_INDEX_SCOPE,
    rows: [],
    blockers: [...new Set(blockers)],
    readOnly: true,
    contextOnly: true,
    weightedConstituentContributionRequired: true,
    equalCountBreadthForbidden: true,
    aiExplanationOnly: true,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  });

  if (!ISO_DATE.test(input.asOfDate) || !Number.isFinite(Date.parse(`${input.asOfDate}T00:00:00Z`))) {
    blockers.push("SEVEN_INDEX_AS_OF_DATE_INVALID");
    return fail();
  }
  if (!Number.isInteger(input.maxStaleCalendarDays) || input.maxStaleCalendarDays < 0) {
    blockers.push("SEVEN_INDEX_STALENESS_POLICY_INVALID");
    return fail();
  }
  if (!Array.isArray(input.rows) || input.rows.length !== CANONICAL_SEVEN_INDEX_SCOPE.length) {
    blockers.push("SEVEN_INDEX_EXACT_SCOPE_COUNT_REQUIRED");
    return fail();
  }

  const seen = new Set<string>();
  const expected = new Set<string>(CANONICAL_SEVEN_INDEX_SCOPE);
  const asOfMs = Date.parse(`${input.asOfDate}T00:00:00Z`);

  for (const row of input.rows) {
    if (!expected.has(row.indexId)) blockers.push(`SEVEN_INDEX_SCOPE_MEMBER_UNEXPECTED:${row.indexId}`);
    if (seen.has(row.indexId)) blockers.push(`SEVEN_INDEX_SCOPE_MEMBER_DUPLICATE:${row.indexId}`);
    seen.add(row.indexId);
    if (!sourceIsOfficial(row.sourceUrl)) blockers.push(`SEVEN_INDEX_SOURCE_NOT_OFFICIAL:${row.indexId}`);
    if (!ISO_DATE.test(row.sourceDate) || !Number.isFinite(Date.parse(`${row.sourceDate}T00:00:00Z`))) {
      blockers.push(`SEVEN_INDEX_SOURCE_DATE_INVALID:${row.indexId}`);
    } else {
      const sourceMs = Date.parse(`${row.sourceDate}T00:00:00Z`);
      const staleDays = Math.floor((asOfMs - sourceMs) / 86_400_000);
      if (sourceMs > asOfMs) blockers.push(`SEVEN_INDEX_SOURCE_FUTURE:${row.indexId}`);
      if (staleDays > input.maxStaleCalendarDays) blockers.push(`SEVEN_INDEX_SOURCE_STALE:${row.indexId}`);
    }
    if (!HASH.test(row.sourceHash)) blockers.push(`SEVEN_INDEX_SOURCE_HASH_INVALID:${row.indexId}`);
    for (const [name, value] of Object.entries({
      ltp: row.ltp,
      previousClose: row.previousClose,
      returnPct: row.returnPct,
      weightedBreadthPct: row.weightedBreadthPct,
      sectorBreadthPct: row.sectorBreadthPct,
    })) {
      if (!Number.isFinite(value)) blockers.push(`SEVEN_INDEX_VALUE_INVALID:${row.indexId}:${name}`);
    }
    if (row.ltp <= 0 || row.previousClose <= 0) blockers.push(`SEVEN_INDEX_PRICE_INVALID:${row.indexId}`);
    if (row.weightedBreadthPct < -100 || row.weightedBreadthPct > 100) blockers.push(`SEVEN_INDEX_WEIGHTED_BREADTH_OUT_OF_RANGE:${row.indexId}`);
    if (row.sectorBreadthPct < -100 || row.sectorBreadthPct > 100) blockers.push(`SEVEN_INDEX_SECTOR_BREADTH_OUT_OF_RANGE:${row.indexId}`);
  }

  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) {
    if (!seen.has(indexId)) blockers.push(`SEVEN_INDEX_SCOPE_MEMBER_MISSING:${indexId}`);
  }
  if (blockers.length) return fail();

  const rows = [...input.rows].sort((a, b) => CANONICAL_SEVEN_INDEX_SCOPE.indexOf(a.indexId) - CANONICAL_SEVEN_INDEX_SCOPE.indexOf(b.indexId));
  return {
    version: CANONICAL_SEVEN_INDEX_INTELLIGENCE_FREEZE_V1,
    ready: true,
    scope: CANONICAL_SEVEN_INDEX_SCOPE,
    rows,
    blockers: [],
    readOnly: true,
    contextOnly: true,
    weightedConstituentContributionRequired: true,
    equalCountBreadthForbidden: true,
    aiExplanationOnly: true,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}
