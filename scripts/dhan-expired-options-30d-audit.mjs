const accessToken = (process.env.DHAN_ACCESS_TOKEN || "").trim();
const clientId = (process.env.DHAN_CLIENT_ID || "").trim();

if (!accessToken || !clientId) {
  console.error(JSON.stringify({
    ok: false,
    error: "DHAN_ACCESS_TOKEN or DHAN_CLIENT_ID missing",
    tokenExposed: false,
  }, null, 2));
  process.exit(1);
}

const symbol = (process.env.DHAN_SYMBOL || "NIFTY").toUpperCase();
const fromDate = process.env.DHAN_FROM_DATE || "2026-07-02";
const toDate = process.env.DHAN_TO_DATE || "2026-08-01";
const range = Math.max(0, Math.min(10, Number(process.env.DHAN_STRIKE_RANGE || 3)));

const underlyingMap = {
  NIFTY: { securityId: 13, exchangeSegment: "NSE_FNO" },
  BANKNIFTY: { securityId: 25, exchangeSegment: "NSE_FNO" },
  SENSEX: { securityId: 51, exchangeSegment: "BSE_FNO" },
};

const mapping = underlyingMap[symbol];
if (!mapping) {
  console.error(JSON.stringify({ ok: false, error: `Unsupported symbol: ${symbol}` }, null, 2));
  process.exit(1);
}

const strikes = ["ATM"];
for (let i = 1; i <= range; i++) strikes.push(`ATM+${i}`, `ATM-${i}`);
const sides = ["CALL", "PUT"];
const results = [];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const strike of strikes) {
  for (const side of sides) {
    const body = {
      exchangeSegment: mapping.exchangeSegment,
      interval: "1",
      securityId: mapping.securityId,
      instrument: "OPTIDX",
      expiryFlag: "WEEK",
      expiryCode: 1,
      strike,
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
          "access-token": accessToken,
          "client-id": clientId,
        },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}

      const node = side === "CALL" ? payload?.data?.ce : payload?.data?.pe;
      const timestamp = Array.isArray(node?.timestamp) ? node.timestamp : [];
      const fields = ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot", "timestamp"];
      const fieldAudit = {};
      for (const field of fields) {
        const v = node?.[field];
        fieldAudit[field] = {
          present: Array.isArray(v),
          count: Array.isArray(v) ? v.length : 0,
          first: Array.isArray(v) && v.length ? v[0] : null,
          last: Array.isArray(v) && v.length ? v[v.length - 1] : null,
        };
      }

      results.push({
        strike,
        side,
        httpStatus: res.status,
        ok: res.ok && Boolean(node) && timestamp.length > 0,
        candleCount: timestamp.length,
        fieldAudit,
        providerError: !res.ok || !node ? {
          errorType: payload?.errorType ?? null,
          errorCode: payload?.errorCode ?? null,
          errorMessage: payload?.errorMessage ?? null,
          rawSnippet: raw.slice(0, 300),
        } : null,
      });
    } catch (err) {
      results.push({ strike, side, ok: false, candleCount: 0, error: err instanceof Error ? err.message : String(err) });
    }

    await sleep(450);
  }
}

const passed = results.filter((r) => r.ok).length;
const report = {
  architectureRole: "DHAN_EXPIRED_OPTIONS_30D_STANDALONE_AUDIT_V1",
  generatedAt: new Date().toISOString(),
  readOnlyMode: true,
  orderAccessUsed: false,
  tokenExposed: false,
  symbol,
  window: { fromDate, toDate, toDateNonInclusive: true },
  strikeRange: `ATM ±${range}`,
  totalRequests: results.length,
  passed,
  failed: results.length - passed,
  status: passed === results.length ? "PASS" : passed > 0 ? "PARTIAL" : "FAIL",
  safeForOneYearExpansion: passed === results.length,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (passed === 0) process.exitCode = 2;
