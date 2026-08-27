type TokenProvider = () => Promise<string | null>;
type TokenRefresher = () => Promise<string | null>;

let cache: any = null;
let cacheAt = 0;
let inFlight: Promise<any> | null = null;
const CACHE_MS = 15 * 60 * 1000;

function isInvalidToken(status: number, payload: any, raw: string) {
  const text = `${payload?.errorMessage || ""} ${payload?.message || ""} ${raw || ""}`.toLowerCase();
  return status === 400 && text.includes("invalid token") || status === 401 || text.includes("token invalid") || text.includes("token is invalid") || text.includes("expired");
}

async function callSide(token: string, clientId: string, side: "CALL" | "PUT") {
  const body = {
    exchangeSegment: "NSE_FNO",
    interval: "1",
    securityId: 13,
    instrument: "OPTIDX",
    expiryFlag: "WEEK",
    expiryCode: 1,
    strike: "ATM",
    drvOptionType: side,
    requiredData: ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot"],
    fromDate: "2026-07-02",
    toDate: "2026-07-09",
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
    side,
    httpStatus: res.status,
    invalidToken: isInvalidToken(res.status, payload, raw),
    ok: res.ok && Boolean(node) && timestamps.length > 0,
    candleCount: timestamps.length,
    fields: {
      oi: Array.isArray(node?.oi) ? node.oi.length : 0,
      iv: Array.isArray(node?.iv) ? node.iv.length : 0,
      volume: Array.isArray(node?.volume) ? node.volume.length : 0,
      spot: Array.isArray(node?.spot) ? node.spot.length : 0,
      close: Array.isArray(node?.close) ? node.close.length : 0,
    },
    error: !res.ok || !node ? (payload?.errorMessage || raw.slice(0, 180) || "UNKNOWN") : null,
  };
}

async function runAudit(getToken: TokenProvider, refreshToken: TokenRefresher) {
  const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
  if (!clientId) return { ok: false, status: "FAIL", error: "DHAN_CLIENT_ID missing" };

  let token = await getToken();
  if (!token) return { ok: false, status: "FAIL", error: "No valid Dhan token" };

  const sides = ["CALL", "PUT"] as const;
  const results: any[] = [];
  let forcedRefreshUsed = false;

  for (const side of sides) {
    try {
      let result = await callSide(token, clientId, side);
      if (result.invalidToken) {
        const fresh = await refreshToken();
        forcedRefreshUsed = true;
        if (fresh) {
          token = fresh;
          result = await callSide(token, clientId, side);
        }
      }
      results.push(result);
    } catch (err) {
      results.push({ side, ok: false, candleCount: 0, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 650));
  }

  const passed = results.filter((r) => r.ok).length;
  const totalCandles = results.reduce((sum, r) => sum + (r.candleCount || 0), 0);
  const status = passed === results.length ? "PASS" : passed > 0 ? "PARTIAL" : "FAIL";

  return {
    ok: status === "PASS",
    architectureRole: "DHAN_EXPIRED_OPTIONS_7D_DIRECT_AUDIT_V2",
    generatedAt: new Date().toISOString(),
    readOnlyMode: true,
    tokenExposed: false,
    forcedRefreshUsed,
    symbol: "NIFTY",
    window: { fromDate: "2026-07-02", toDate: "2026-07-09", toDateNonInclusive: true },
    scope: "ATM, CALL+PUT, 1-minute",
    passed,
    failed: results.length - passed,
    totalCandles,
    status,
    safeFor30DayExpansion: status === "PASS",
    results,
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
