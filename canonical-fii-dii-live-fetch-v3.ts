import { parseOfficialFiiDiiApiPayload } from "./canonical-fii-dii-practical-ingest-v2.ts";
import type { FiiDiiDailyRow } from "./canonical-fii-dii-official-context.ts";

export const NSE_FII_DII_OFFICIAL_ENDPOINTS = [
  "https://www.nseindia.com/api/fiidiiTradeNse",
  "https://www.nseindia.com/api/fiidiiTradeReact",
] as const;
const HOME = "https://www.nseindia.com/";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

function cookieHeader(headers: Headers): string | null {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const raw = values.length ? values : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  return raw.length ? raw.map(v=>v.split(";",1)[0]).filter(Boolean).join("; ") : null;
}

async function parseResponse(response: Response): Promise<FiiDiiDailyRow[] | null> {
  if (!response.ok) return null;
  try {
    const parsed = parseOfficialFiiDiiApiPayload(await response.json());
    return !parsed.blockers.length && parsed.rows.length === 2 ? parsed.rows : null;
  } catch { return null; }
}

const baseHeaders = { "user-agent":UA, accept:"application/json,text/plain,*/*", "accept-language":"en-US,en;q=0.9", referer:HOME };

export async function fetchOfficialFiiDiiLiveV3(policy: { retryCount:number }, fetchImpl: typeof fetch = fetch): Promise<{ ok:boolean; rows:FiiDiiDailyRow[]; attempts:number; sourceUrl:string|null; blocker:string|null }> {
  if (!Number.isInteger(policy?.retryCount) || policy.retryCount < 0 || policy.retryCount > 5) return {ok:false,rows:[],attempts:0,sourceUrl:null,blocker:"FII_DII_FETCH_POLICY_INVALID"};
  let attempts=0;
  for (; attempts<=policy.retryCount; attempts++) {
    for (const sourceUrl of NSE_FII_DII_OFFICIAL_ENDPOINTS) {
      try {
        const direct = await fetchImpl(sourceUrl,{headers:baseHeaders});
        const rows = await parseResponse(direct);
        if (rows) return {ok:true,rows,attempts:attempts+1,sourceUrl,blocker:null};
      } catch { /* continue to session path */ }
    }
    try {
      const home = await fetchImpl(HOME,{headers:{"user-agent":UA,accept:"text/html,application/xhtml+xml","accept-language":"en-US,en;q=0.9"}});
      if (!home.ok) continue;
      const cookie=cookieHeader(home.headers);
      for (const sourceUrl of NSE_FII_DII_OFFICIAL_ENDPOINTS) {
        try {
          const api=await fetchImpl(sourceUrl,{headers:{...baseHeaders,...(cookie?{cookie}:{})}});
          const rows=await parseResponse(api);
          if (rows) return {ok:true,rows,attempts:attempts+1,sourceUrl,blocker:null};
        } catch { /* try next endpoint */ }
      }
    } catch { /* retry full attempt */ }
  }
  return {ok:false,rows:[],attempts,sourceUrl:null,blocker:"FII_DII_OFFICIAL_ENDPOINTS_UNREACHABLE"};
}
