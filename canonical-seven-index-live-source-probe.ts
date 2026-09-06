import { CANONICAL_SEVEN_INDEX_SCOPE, type CanonicalSevenIndexId } from "./canonical-seven-index-intelligence-freeze.ts";

export const CANONICAL_SEVEN_INDEX_LIVE_SOURCE_PROBE_V1 = "CANONICAL_SEVEN_INDEX_LIVE_SOURCE_PROBE_V1" as const;
const HOST = "www.niftyindices.com";
const BASE = "https://www.niftyindices.com/market-data/index-moversData";

export const SEVEN_INDEX_OFFICIAL_PAGE_NAMES: Record<CanonicalSevenIndexId, string> = {
  NIFTY_50: "Nifty 50",
  NIFTY_NEXT_50: "Nifty Next 50",
  NIFTY_100: "Nifty 100",
  NIFTY_200: "Nifty 200",
  NIFTY_500: "Nifty 500",
  NIFTY_MIDCAP_150: "Nifty Midcap 150",
  NIFTY_SMALLCAP_250: "Nifty Smallcap 250",
};

export interface SevenIndexSourceProbeRow {
  indexId: CanonicalSevenIndexId;
  officialName: string;
  sourceUrl: string;
  ok: boolean;
  status: number | null;
  blocker: string | null;
}

export interface SevenIndexSourceProbeResult {
  version: typeof CANONICAL_SEVEN_INDEX_LIVE_SOURCE_PROBE_V1;
  ready: boolean;
  rows: SevenIndexSourceProbeRow[];
  blockers: string[];
  readOnly: true;
  sourceIdentityOnly: true;
  parsesMarketValues: false;
  grantsDirectionalSupport: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  failClosed: true;
}

export function officialSevenIndexPageUrl(indexId: CanonicalSevenIndexId): string {
  const name = SEVEN_INDEX_OFFICIAL_PAGE_NAMES[indexId];
  return `${BASE}?Iname=${encodeURIComponent(name)}`;
}

function validOfficialUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === HOST && parsed.pathname === "/market-data/index-moversData";
  } catch {
    return false;
  }
}

function normalizeHtmlText(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").toLowerCase();
}

export async function probeOfficialSevenIndexPages(fetchImpl: typeof fetch = fetch): Promise<SevenIndexSourceProbeResult> {
  const rows: SevenIndexSourceProbeRow[] = [];
  const blockers: string[] = [];
  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) {
    const officialName = SEVEN_INDEX_OFFICIAL_PAGE_NAMES[indexId];
    const sourceUrl = officialSevenIndexPageUrl(indexId);
    if (!validOfficialUrl(sourceUrl)) {
      const blocker = `SEVEN_INDEX_SOURCE_URL_INVALID:${indexId}`;
      blockers.push(blocker);
      rows.push({ indexId, officialName, sourceUrl, ok: false, status: null, blocker });
      continue;
    }
    try {
      const response = await fetchImpl(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) {
        const blocker = `SEVEN_INDEX_SOURCE_HTTP_${response.status}:${indexId}`;
        blockers.push(blocker);
        rows.push({ indexId, officialName, sourceUrl, ok: false, status: response.status, blocker });
        continue;
      }
      const body = normalizeHtmlText(await response.text());
      const hasIndexMovers = body.includes("index movers");
      const hasIdentity = body.includes(officialName.toLowerCase());
      if (!hasIndexMovers || !hasIdentity) {
        const blocker = `SEVEN_INDEX_SOURCE_IDENTITY_MISMATCH:${indexId}`;
        blockers.push(blocker);
        rows.push({ indexId, officialName, sourceUrl, ok: false, status: response.status, blocker });
        continue;
      }
      rows.push({ indexId, officialName, sourceUrl, ok: true, status: response.status, blocker: null });
    } catch {
      const blocker = `SEVEN_INDEX_SOURCE_FETCH_FAILED:${indexId}`;
      blockers.push(blocker);
      rows.push({ indexId, officialName, sourceUrl, ok: false, status: null, blocker });
    }
  }
  return {
    version: CANONICAL_SEVEN_INDEX_LIVE_SOURCE_PROBE_V1,
    ready: blockers.length === 0 && rows.length === CANONICAL_SEVEN_INDEX_SCOPE.length && rows.every((row) => row.ok),
    rows,
    blockers,
    readOnly: true,
    sourceIdentityOnly: true,
    parsesMarketValues: false,
    grantsDirectionalSupport: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}
