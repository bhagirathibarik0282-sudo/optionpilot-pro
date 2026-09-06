import type { FiiDiiDailyRow, InstitutionalCategory, InstitutionalWindow } from "./canonical-fii-dii-official-context.ts";

export const CANONICAL_FII_DII_PRACTICAL_INGEST_V2 = "CANONICAL_FII_DII_PRACTICAL_INGEST_V2" as const;
export const NSE_FII_DII_API_URL = "https://www.nseindia.com/api/fiidiiTradeReact" as const;
export const NSE_HOME_URL = "https://www.nseindia.com/" as const;

const WINDOWS: Array<[InstitutionalWindow, number]> = [["1D",1],["3D",3],["5D",5],["20D",20]];
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

export interface PracticalWindowContext {
  window: InstitutionalWindow;
  requiredSessions: number;
  ready: boolean;
  availableSessions: number;
  fiiNetCrore: number | null;
  diiNetCrore: number | null;
  combinedNetCrore: number | null;
}

export interface CanonicalFiiDiiPracticalContextV2 {
  version: typeof CANONICAL_FII_DII_PRACTICAL_INGEST_V2;
  ready: boolean;
  latestSessionDate: string | null;
  history: FiiDiiDailyRow[];
  windows: PracticalWindowContext[];
  blockers: string[];
  warnings: string[];
  sourceUrl: typeof NSE_FII_DII_API_URL;
  sourceMode: "OFFICIAL_NSE_SESSION_API";
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

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : null;
  const m = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months: Record<string,string> = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
  const mm = months[m[2].toLowerCase()]; if (!mm) return null;
  const out = `${m[3]}-${mm}-${m[1].padStart(2,"0")}`;
  return Number.isFinite(Date.parse(`${out}T00:00:00Z`)) ? out : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[₹,\s]/g,""));
  return Number.isFinite(n) ? n : null;
}

function categoryValue(value: unknown): InstitutionalCategory | null {
  if (typeof value !== "string") return null;
  const v = value.toUpperCase().replace(/[\s*]+/g,"");
  if (v === "DII") return "DII";
  if (v === "FII/FPI" || v === "FII" || v === "FPI") return "FII_FPI";
  return null;
}

export function parseOfficialFiiDiiApiPayload(payload: unknown): { rows: FiiDiiDailyRow[]; blockers: string[] } {
  if (!Array.isArray(payload) || payload.length === 0) return { rows: [], blockers: ["FII_DII_API_PAYLOAD_EMPTY"] };
  const rows: FiiDiiDailyRow[] = []; const blockers: string[] = []; const seen = new Set<string>();
  for (const item of payload) {
    if (!item || typeof item !== "object") { blockers.push("FII_DII_API_ROW_MALFORMED"); continue; }
    const r = item as Record<string,unknown>;
    const category = categoryValue(r.category);
    const date = isoDate(r.date);
    const buy = numberValue(r.buyValue ?? r.buyCrore);
    const sell = numberValue(r.sellValue ?? r.sellCrore);
    const net = numberValue(r.netValue ?? r.netCrore);
    if (!category || !date || buy === null || sell === null || net === null || buy < 0 || sell < 0) { blockers.push("FII_DII_API_ROW_MALFORMED"); continue; }
    if (Math.abs((buy - sell) - net) > 0.02) { blockers.push(`FII_DII_API_NET_MISMATCH:${date}:${category}`); continue; }
    const key = `${date}:${category}`;
    if (seen.has(key)) { blockers.push(`FII_DII_API_DUPLICATE:${key}`); continue; }
    seen.add(key); rows.push({ date, category, buyCrore: buy, sellCrore: sell, netCrore: net });
  }
  const dates = [...new Set(rows.map(r=>r.date))];
  for (const date of dates) {
    const count = rows.filter(r=>r.date===date).length;
    const hasFii = rows.some(r=>r.date===date && r.category==="FII_FPI");
    const hasDii = rows.some(r=>r.date===date && r.category==="DII");
    if (count !== 2 || !hasFii || !hasDii) blockers.push(`FII_DII_API_INCOMPLETE_SESSION:${date}`);
  }
  return { rows, blockers: [...new Set(blockers)] };
}

export function mergeFiiDiiHistory(existing: FiiDiiDailyRow[], incoming: FiiDiiDailyRow[], maxSessions = 60): { rows: FiiDiiDailyRow[]; blockers: string[] } {
  if (!Number.isInteger(maxSessions) || maxSessions < 20) return { rows: [], blockers: ["FII_DII_HISTORY_POLICY_INVALID"] };
  const map = new Map<string,FiiDiiDailyRow>(); const blockers: string[] = [];
  for (const row of [...existing, ...incoming]) {
    const key = `${row.date}:${row.category}`; const prior = map.get(key);
    if (prior && (prior.buyCrore !== row.buyCrore || prior.sellCrore !== row.sellCrore || prior.netCrore !== row.netCrore)) {
      blockers.push(`FII_DII_HISTORY_CONFLICT:${key}`); continue;
    }
    map.set(key, row);
  }
  if (blockers.length) return { rows: [], blockers };
  const dates = [...new Set([...map.values()].map(r=>r.date))].sort();
  const completeDates = dates.filter(date => map.has(`${date}:FII_FPI`) && map.has(`${date}:DII`)).slice(-maxSessions);
  return { rows: [...map.values()].filter(r=>completeDates.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.category.localeCompare(b.category)), blockers: [] };
}

export function buildPracticalFiiDiiContextV2(input: { history: FiiDiiDailyRow[]; asOfDate: string; maxStaleCalendarDays: number }): CanonicalFiiDiiPracticalContextV2 {
  const fail = (blockers: string[]): CanonicalFiiDiiPracticalContextV2 => ({ version: CANONICAL_FII_DII_PRACTICAL_INGEST_V2, ready:false, latestSessionDate:null, history:[], windows:[], blockers:[...new Set(blockers)], warnings:[], sourceUrl:NSE_FII_DII_API_URL, sourceMode:"OFFICIAL_NSE_SESSION_API", readOnly:true, previousSessionContextOnly:true, estimatesMissingValues:false, grantsDirectionalSupport:false, affectsVerdict:false, affectsCandidate:false, affectsExecution:false, affectsTelegram:false, failClosed:true });
  const asOf = isoDate(input.asOfDate); if (!asOf) return fail(["FII_DII_AS_OF_DATE_INVALID"]);
  if (!Number.isInteger(input.maxStaleCalendarDays) || input.maxStaleCalendarDays < 0) return fail(["FII_DII_STALENESS_POLICY_INVALID"]);
  const merged = mergeFiiDiiHistory([], input.history); if (merged.blockers.length) return fail(merged.blockers);
  const dates = [...new Set(merged.rows.map(r=>r.date))].sort(); if (!dates.length) return fail(["FII_DII_HISTORY_EMPTY"]);
  const latest = dates.at(-1)!; const latestMs = Date.parse(`${latest}T00:00:00Z`); const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (latestMs > asOfMs) return fail(["FII_DII_FUTURE_SESSION"]);
  const staleDays = Math.floor((asOfMs-latestMs)/86_400_000); if (staleDays > input.maxStaleCalendarDays) return fail(["FII_DII_SOURCE_STALE"]);
  const windows = WINDOWS.map(([window,requiredSessions]) => {
    const chosen = dates.slice(-requiredSessions); const ready = chosen.length >= requiredSessions;
    if (!ready) return { window, requiredSessions, ready:false, availableSessions:chosen.length, fiiNetCrore:null, diiNetCrore:null, combinedNetCrore:null };
    const fii = merged.rows.filter(r=>chosen.includes(r.date)&&r.category==="FII_FPI").reduce((s,r)=>s+r.netCrore,0);
    const dii = merged.rows.filter(r=>chosen.includes(r.date)&&r.category==="DII").reduce((s,r)=>s+r.netCrore,0);
    return { window, requiredSessions, ready:true, availableSessions:chosen.length, fiiNetCrore:fii, diiNetCrore:dii, combinedNetCrore:fii+dii };
  });
  const warnings = windows.filter(w=>!w.ready).map(w=>`FII_DII_WINDOW_NOT_READY:${w.window}:${w.availableSessions}/${w.requiredSessions}`);
  return { version:CANONICAL_FII_DII_PRACTICAL_INGEST_V2, ready:windows[0].ready, latestSessionDate:latest, history:merged.rows, windows, blockers:[], warnings, sourceUrl:NSE_FII_DII_API_URL, sourceMode:"OFFICIAL_NSE_SESSION_API", readOnly:true, previousSessionContextOnly:true, estimatesMissingValues:false, grantsDirectionalSupport:false, affectsVerdict:false, affectsCandidate:false, affectsExecution:false, affectsTelegram:false, failClosed:true };
}

function cookieHeader(headers: Headers): string | null {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const values = cookies.length ? cookies : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  if (!values.length) return null;
  return values.map(v=>v.split(";",1)[0]).filter(Boolean).join("; ");
}

export async function fetchOfficialFiiDiiApi(policy: { retryCount: number }, fetchImpl: typeof fetch = fetch): Promise<{ ok:boolean; rows:FiiDiiDailyRow[]; attempts:number; blocker:string|null }> {
  if (!Number.isInteger(policy?.retryCount) || policy.retryCount < 0 || policy.retryCount > 5) return { ok:false, rows:[], attempts:0, blocker:"FII_DII_FETCH_POLICY_INVALID" };
  let attempts = 0;
  for (; attempts <= policy.retryCount; attempts++) {
    try {
      const home = await fetchImpl(NSE_HOME_URL, { headers: { "user-agent":USER_AGENT, accept:"text/html,application/xhtml+xml", "accept-language":"en-US,en;q=0.9" } });
      if (!home.ok) continue;
      const cookie = cookieHeader(home.headers);
      const api = await fetchImpl(NSE_FII_DII_API_URL, { headers: { "user-agent":USER_AGENT, accept:"application/json,text/plain,*/*", "accept-language":"en-US,en;q=0.9", referer:NSE_HOME_URL, ...(cookie ? { cookie } : {}) } });
      if (!api.ok) continue;
      const parsed = parseOfficialFiiDiiApiPayload(await api.json());
      if (!parsed.blockers.length && parsed.rows.length === 2) return { ok:true, rows:parsed.rows, attempts:attempts+1, blocker:null };
    } catch { /* retry full session handshake; never synthesize data */ }
  }
  return { ok:false, rows:[], attempts, blocker:"FII_DII_OFFICIAL_API_FETCH_FAILED" };
}
