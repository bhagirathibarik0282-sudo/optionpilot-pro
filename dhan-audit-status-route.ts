type TokenProvider = () => Promise<string | null>;

let cache: any = null;
let cacheAt = 0;
let inFlight: Promise<any> | null = null;
const CACHE_MS = 15 * 60 * 1000;

async function runAudit(getToken: TokenProvider) {
  const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
  if (!clientId) return { ok: false, status: "FAIL", error: "DHAN_CLIENT_ID missing" };

  const token = await getToken();
  if (!token) return { ok: false, status: "FAIL", error: "No valid Dhan token" };

  const fromDate = "2026-07-02";
  const toDate = "2026-07-09";
  const sides = ["CALL", "PUT"] as const;
  const results: any[] = [];

  for (const side of sides) {
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
      fromDate,
      toDate,
    };

    try {
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
      results.push({
        side,
        httpStatus: res.status,
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
      });
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
    architectureRole: "DHAN_EXPIRED_OPTIONS_7D_DIRECT_AUDIT_V1",
    generatedAt: new Date().toISOString(),
    readOnlyMode: true,
    tokenExposed: false,
    symbol: "NIFTY",
    window: { fromDate, toDate, toDateNonInclusive: true },
    scope: "ATM, CALL+PUT, 1-minute",
    passed,
    failed: results.length - passed,
    totalCandles,
    status,
    safeFor30DayExpansion: status === "PASS",
    results,
  };
}

export function mountDhanAuditStatusRoute(app: any, getToken: TokenProvider) {
  app.get("/api/research/dhan-audit-status", async (c: any) => {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_MS) return c.json({ cached: true, ...cache }, 200);

    if (!inFlight) {
      inFlight = runAudit(getToken)
        .then((result) => {
          cache = result;
          cacheAt = Date.now();
          return result;
        })
        .finally(() => { inFlight = null; });
    }

    const result = await inFlight;
    return c.json({ cached: false, ...result }, 200);
  });
}
