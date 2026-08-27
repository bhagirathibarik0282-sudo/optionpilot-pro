type TokenProvider = () => Promise<string | null>;
type TokenRefresher = () => Promise<string | null>;

let cache: any = null;
let cacheAt = 0;
let inFlight: Promise<any> | null = null;
const CACHE_MS = 15 * 60 * 1000;

function isInvalidToken(status: number, payload: any, raw: string) {
  const text = `${payload?.errorMessage || ""} ${payload?.message || ""} ${raw || ""}`.toLowerCase();
  return (status === 400 && text.includes("invalid token")) || status === 401 || text.includes("token invalid") || text.includes("token is invalid") || text.includes("expired");
}

async function callOne(token: string, clientId: string, side: "CALL" | "PUT", strike: string, fromDate: string, toDate: string) {
  const body = {
    exchangeSegment: "NSE_FNO",
    interval: "1",
    securityId: 13,
    instrument: "OPTIDX",
    expiryFlag: "WEEK",
    expiryCode: 1,
    strike,
    drvOptionType: side,
    requiredData: ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot"],
    fromDate,
    toDate,
  };

  const res = await fetch("https://api.dhan.co/v2/charts/rollingoption", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "access-token": token,
      "client-id": clientId,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch {}
  const node = side === "CALL" ? payload?.data?.ce : payload?.data?.pe;
  const timestamps = Array.isArray(node?.timestamp) ? node.timestamp : [];

  return {
    httpStatus: res.status,
    invalidToken: isInvalidToken(res.status, payload, raw),
    ok: res.ok && Boolean(node) && timestamps.length > 0,
    candleCount: timestamps.length,
    fieldsOk: ["oi", "iv", "volume", "spot", "close"].every((f) => Array.isArray(node?.[f]) && node[f].length === timestamps.length),
    error: !res.ok || !node ? (payload?.errorMessage || raw.slice(0, 120) || "UNKNOWN") : null,
  };
}

async function runAudit(getToken: TokenProvider, refreshToken: TokenRefresher) {
  const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
  if (!clientId) return { ok: false, status: "FAIL", error: "DHAN_CLIENT_ID missing" };

  let token = await getToken();
  if (!token) return { ok: false, status: "FAIL", error: "No valid Dhan token" };

  const chunks = [
    ["2026-07-02", "2026-07-09"],
    ["2026-07-09", "2026-07-16"],
    ["2026-07-16", "2026-07-23"],
    ["2026-07-23", "2026-07-30"],
    ["2026-07-30", "2026-08-01"],
  ] as const;
  const strikes = ["ATM", "ATM+1", "ATM-1", "ATM+2", "ATM-2", "ATM+3", "ATM-3"];
  const sides = ["CALL", "PUT"] as const;
  const chunkSummary: any[] = [];
  let forcedRefreshCount = 0;
  let totalRequests = 0;
  let passed = 0;
  let totalCandles = 0;
  let firstError: any = null;

  for (let ci = 0; ci < chunks.length; ci++) {
    const [fromDate, toDate] = chunks[ci];
    let chunkPassed = 0;
    let chunkFailed = 0;
    let chunkCandles = 0;

    for (const strike of strikes) {
      for (const side of sides) {
        totalRequests++;
        try {
          let result = await callOne(token, clientId, side, strike, fromDate, toDate);
          if (result.invalidToken) {
            const fresh = await refreshToken();
            forcedRefreshCount++;
            if (fresh) {
              token = fresh;
              result = await callOne(token, clientId, side, strike, fromDate, toDate);
            }
          }

          if (result.ok && result.fieldsOk) {
            passed++;
            chunkPassed++;
            totalCandles += result.candleCount;
            chunkCandles += result.candleCount;
          } else {
            chunkFailed++;
            if (!firstError) firstError = { chunk: ci + 1, fromDate, toDate, strike, side, httpStatus: result.httpStatus ?? null, error: result.error ?? (result.fieldsOk ? "UNKNOWN" : "FIELD_LENGTH_MISMATCH") };
          }
        } catch (err) {
          chunkFailed++;
          if (!firstError) firstError = { chunk: ci + 1, fromDate, toDate, strike, side, error: err instanceof Error ? err.message : String(err) };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    chunkSummary.push({ chunk: ci + 1, fromDate, toDate, passed: chunkPassed, failed: chunkFailed, totalCandles: chunkCandles });
    await new Promise((r) => setTimeout(r, 700));
  }

  const failed = totalRequests - passed;
  const status = passed === totalRequests && totalRequests > 0 ? "PASS" : passed > 0 ? "PARTIAL" : "FAIL";

  return {
    ok: status === "PASS",
    architectureRole: "DHAN_EXPIRED_OPTIONS_30D_DIRECT_ATM3_AUDIT_V3",
    generatedAt: new Date().toISOString(),
    readOnlyMode: true,
    tokenExposed: false,
    forcedRefreshCount,
    symbol: "NIFTY",
    window: { fromDate: "2026-07-02", toDate: "2026-08-01", toDateNonInclusive: true },
    scope: "ATM±3, CALL+PUT, 1-minute, 7-day chunks",
    chunks: chunks.length,
    totalRequests,
    passed,
    failed,
    totalCandles,
    status,
    safeForOneYearExpansion: status === "PASS",
    firstError,
    chunkSummary,
  };
}

export function mountDhanAuditStatusRoute(app: any, getToken: TokenProvider, refreshToken: TokenRefresher) {
  app.get("/api/research/dhan-audit-status", async (c: any) => {
    const now = Date.now();
    if (cache?.status === "PASS" && now - cacheAt < CACHE_MS) return c.json({ cached: true, ...cache }, 200);

    if (!inFlight) {
      inFlight = runAudit(getToken, refreshToken)
        .then((result) => {
          if (result?.status === "PASS") {
            cache = result;
            cacheAt = Date.now();
          } else {
            cache = null;
            cacheAt = 0;
          }
          return result;
        })
        .finally(() => { inFlight = null; });
    }

    const result = await inFlight;
    return c.json({ cached: false, ...result }, 200);
  });
}
