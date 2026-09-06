export const CANONICAL_FII_DII_OFFICIAL_CONTEXT_V1 = "CANONICAL_FII_DII_OFFICIAL_CONTEXT_V1" as const;

export type InstitutionalCategory = "FII_FPI" | "DII";
export type InstitutionalWindow = "1D" | "3D" | "5D" | "20D";

export interface FiiDiiOfficialFetchPolicy {
  sourceUrl: string;
  asOfDate: string; // YYYY-MM-DD reference date supplied by caller.
  maxStaleCalendarDays: number;
  retryCount: number;
}

export interface FiiDiiDailyRow {
  date: string;
  category: InstitutionalCategory;
  buyCrore: number;
  sellCrore: number;
  netCrore: number;
}

export interface FiiDiiWindowContext {
  window: InstitutionalWindow;
  sessions: number;
  fiiNetCrore: number;
  diiNetCrore: number;
  combinedNetCrore: number;
  fiiAverageCrore: number;
  diiAverageCrore: number;
}

export interface CanonicalFiiDiiOfficialContextResult {
  version: typeof CANONICAL_FII_DII_OFFICIAL_CONTEXT_V1;
  ready: boolean;
  sourceUrl: string | null;
  latestSessionDate: string | null;
  rows: FiiDiiDailyRow[];
  windows: FiiDiiWindowContext[];
  blockers: string[];
  semantics: "INSTITUTIONAL_FLOW_CONTEXT_ONLY_NO_DIRECTION_TRUTH";
  readOnly: true;
  previousSessionContextOnly: true;
  estimatesMissingValues: false;
  grantsDirectionalSupport: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const VERSION = CANONICAL_FII_DII_OFFICIAL_CONTEXT_V1;
const SEMANTICS = "INSTITUTIONAL_FLOW_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const;
const WINDOWS: Array<[InstitutionalWindow, number]> = [["1D", 1], ["3D", 3], ["5D", 5], ["20D", 20]];

function fail(blockers: string[]): CanonicalFiiDiiOfficialContextResult {
  return {
    version: VERSION, ready: false, sourceUrl: null, latestSessionDate: null, rows: [], windows: [],
    blockers: [...new Set(blockers)], semantics: SEMANTICS, readOnly: true, previousSessionContextOnly: true,
    estimatesMissingValues: false, grantsDirectionalSupport: false, affectsVerdict: false, affectsCandidate: false,
    affectsExecution: false, affectsTelegram: false, failClosed: true,
  };
}

function officialNseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "nseindia.com" || url.hostname.endsWith(".nseindia.com"));
  } catch { return false; }
}

function isoDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : null;
  const m = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  const out = `${m[3]}-${mm}-${m[1].padStart(2,"0")}`;
  return Number.isFinite(Date.parse(`${out}T00:00:00Z`)) ? out : null;
}

function numeric(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, "");
  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function csvLine(line: string): string[] {
  const out: string[] = []; let current = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(current.trim()); current = ""; }
    else current += ch;
  }
  out.push(current.trim());
  return out;
}

function headerIndex(headers: string[], predicate: (h: string) => boolean): number {
  return headers.findIndex((h) => predicate(h.toLowerCase().replace(/\s+/g, " ").trim()));
}

export function parseOfficialFiiDiiCsv(csv: string): { rows: FiiDiiDailyRow[]; blockers: string[] } {
  if (typeof csv !== "string" || !csv.trim()) return { rows: [], blockers: ["FII_DII_SOURCE_EMPTY"] };
  const lines = csv.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length < 3) return { rows: [], blockers: ["FII_DII_SOURCE_MALFORMED"] };
  const headers = csvLine(lines[0]);
  const categoryI = headerIndex(headers, (h) => h === "category" || h.includes("category"));
  const dateI = headerIndex(headers, (h) => h === "date" || h.includes("date"));
  const buyI = headerIndex(headers, (h) => h.includes("buy value"));
  const sellI = headerIndex(headers, (h) => h.includes("sell value"));
  const netI = headerIndex(headers, (h) => h.includes("net value"));
  if ([categoryI,dateI,buyI,sellI,netI].some((i) => i < 0)) return { rows: [], blockers: ["FII_DII_HEADER_MALFORMED"] };

  const rows: FiiDiiDailyRow[] = []; const blockers: string[] = []; const keys = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = csvLine(line);
    const rawCategory = (cells[categoryI] ?? "").toUpperCase().replace(/\s+/g, "");
    const category: InstitutionalCategory | null = rawCategory === "DII" ? "DII" : (rawCategory === "FII/FPI" || rawCategory === "FII" || rawCategory === "FPI") ? "FII_FPI" : null;
    const date = isoDate(cells[dateI] ?? "");
    const buy = numeric(cells[buyI] ?? ""); const sell = numeric(cells[sellI] ?? ""); const net = numeric(cells[netI] ?? "");
    if (!category || !date || buy === null || sell === null || net === null || buy < 0 || sell < 0) { blockers.push("FII_DII_ROW_MALFORMED"); continue; }
    if (Math.abs((buy - sell) - net) > 0.02) { blockers.push(`FII_DII_NET_MISMATCH:${date}:${category}`); continue; }
    const key = `${date}:${category}`;
    if (keys.has(key)) { blockers.push(`FII_DII_DUPLICATE:${key}`); continue; }
    keys.add(key); rows.push({ date, category, buyCrore: buy, sellCrore: sell, netCrore: net });
  }
  const dates = [...new Set(rows.map((r) => r.date))];
  for (const date of dates) {
    if (rows.filter((r) => r.date === date && r.category === "FII_FPI").length !== 1 || rows.filter((r) => r.date === date && r.category === "DII").length !== 1) blockers.push(`FII_DII_INCOMPLETE_SESSION:${date}`);
  }
  return { rows, blockers: [...new Set(blockers)] };
}

export function buildCanonicalFiiDiiOfficialContext(input: { sourceUrl: string; csv: string; asOfDate: string; maxStaleCalendarDays: number }): CanonicalFiiDiiOfficialContextResult {
  const blockers: string[] = [];
  if (!officialNseUrl(input?.sourceUrl)) blockers.push("FII_DII_SOURCE_NOT_OFFICIAL_NSE");
  const asOf = isoDate(input?.asOfDate ?? "");
  if (!asOf) blockers.push("FII_DII_AS_OF_DATE_INVALID");
  if (!Number.isInteger(input?.maxStaleCalendarDays) || input.maxStaleCalendarDays < 0) blockers.push("FII_DII_STALENESS_POLICY_INVALID");
  const parsed = parseOfficialFiiDiiCsv(input?.csv ?? ""); blockers.push(...parsed.blockers);
  if (blockers.length || !asOf) return fail(blockers);

  const dates = [...new Set(parsed.rows.map((r) => r.date))].sort();
  if (dates.length < 20) return fail(["FII_DII_20D_HISTORY_INSUFFICIENT"]);
  const latest = dates.at(-1)!;
  const latestMs = Date.parse(`${latest}T00:00:00Z`); const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (latestMs > asOfMs) return fail(["FII_DII_FUTURE_SESSION"]);
  const staleDays = Math.floor((asOfMs - latestMs) / 86_400_000);
  if (staleDays > input.maxStaleCalendarDays) return fail(["FII_DII_SOURCE_STALE"]);

  const complete = dates.slice(-20);
  const windows: FiiDiiWindowContext[] = WINDOWS.map(([window, count]) => {
    const chosen = complete.slice(-count);
    const fii = parsed.rows.filter((r) => chosen.includes(r.date) && r.category === "FII_FPI").reduce((s,r) => s + r.netCrore, 0);
    const dii = parsed.rows.filter((r) => chosen.includes(r.date) && r.category === "DII").reduce((s,r) => s + r.netCrore, 0);
    return { window, sessions: count, fiiNetCrore: fii, diiNetCrore: dii, combinedNetCrore: fii + dii, fiiAverageCrore: fii / count, diiAverageCrore: dii / count };
  });
  return {
    version: VERSION, ready: true, sourceUrl: input.sourceUrl, latestSessionDate: latest, rows: parsed.rows.filter((r) => complete.includes(r.date)), windows,
    blockers: [], semantics: SEMANTICS, readOnly: true, previousSessionContextOnly: true, estimatesMissingValues: false,
    grantsDirectionalSupport: false, affectsVerdict: false, affectsCandidate: false, affectsExecution: false, affectsTelegram: false, failClosed: true,
  };
}

export async function fetchOfficialFiiDiiCsv(policy: FiiDiiOfficialFetchPolicy, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; csv: string | null; attempts: number; blocker: string | null }> {
  if (!officialNseUrl(policy?.sourceUrl) || !isoDate(policy?.asOfDate ?? "") || !Number.isInteger(policy?.retryCount) || policy.retryCount < 0) return { ok: false, csv: null, attempts: 0, blocker: "FII_DII_FETCH_POLICY_INVALID" };
  let attempts = 0;
  for (; attempts <= policy.retryCount; attempts++) {
    try {
      const response = await fetchImpl(policy.sourceUrl, { headers: { accept: "text/csv,text/plain;q=0.9,*/*;q=0.1" } });
      if (response.ok) {
        const csv = await response.text();
        if (csv.trim()) return { ok: true, csv, attempts: attempts + 1, blocker: null };
      }
    } catch { /* retry only; never synthesize */ }
  }
  return { ok: false, csv: null, attempts, blocker: "FII_DII_OFFICIAL_FETCH_FAILED" };
}
