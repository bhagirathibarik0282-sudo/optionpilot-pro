// ============================================================================
// OPTIONPILOT — DHAN EXPIRED OPTIONS 30-DAY SAMPLE AUDIT
// READ-ONLY / RESEARCH ONLY / NO ORDERS / NO DATABASE WRITE
//
// Purpose:
//   Validate a real 30-day NIFTY expired-options sample from Dhan before
//   starting the 1-year downloader.
//
// Default sample:
//   2026-07-02 -> 2026-08-01 (Dhan toDate is non-inclusive = 30 days)
//   WEEK, expiryCode=1, ATM ±3, CALL + PUT, 1-minute
//
// IMPORTANT:
//   Dhan official requiredData key is "iv" (NOT "implied_volatility").
// ============================================================================

app.get("/api/research/dhan-expired-options-30d-audit", async (c) => {
  const auditKey = process.env.DHAN_AUDIT_KEY?.trim() || "";
  const providedKey = c.req.query("key")?.trim() || "";
  if (!auditKey || providedKey !== auditKey) {
    return c.json({ status: "ERROR", error: "Missing or invalid audit key." }, 403);
  }

  const symbol = (c.req.query("symbol") || "NIFTY").trim().toUpperCase();
  const mapping = DHAN_UNDERLYING_MAP[symbol];
  if (!mapping) {
    return c.json({
      status: "ERROR",
      error: "Symbol not in DHAN_UNDERLYING_MAP.",
      supportedSymbols: Object.keys(DHAN_UNDERLYING_MAP),
    }, 400);
  }

  const accessToken = (await getValidDhanAccessToken()) || "";
  const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
  if (!accessToken || !clientId) {
    return c.json({
      status: "ERROR",
      error: "Dhan credentials are not configured.",
      tokenExposed: false,
    }, 503);
  }

  // 30-day test window. Dhan's toDate is non-inclusive.
  const fromDate = c.req.query("from") || "2026-07-02";
  const toDate = c.req.query("to") || "2026-08-01";

  const requestedRange = Number.parseInt(c.req.query("range") || "3", 10);
  const strikeRange = Number.isFinite(requestedRange)
    ? Math.max(0, Math.min(10, requestedRange))
    : 3;

  const optionsSegment = symbol === "SENSEX" ? "BSE_FNO" : "NSE_FNO";
  const strikes = ["ATM"];
  for (let i = 1; i <= strikeRange; i++) {
    strikes.push(`ATM+${i}`, `ATM-${i}`);
  }

  const sides = ["CALL", "PUT"] as const;
  const results: any[] = [];

  for (const strike of strikes) {
    for (const side of sides) {
      const requestBody = {
        exchangeSegment: optionsSegment,
        interval: "1",
        securityId: mapping.underlyingScrip,
        instrument: "OPTIDX",
        expiryFlag: "WEEK",
        expiryCode: 1,
        strike,
        drvOptionType: side,
        requiredData: [
          "open",
          "high",
          "low",
          "close",
          "iv",
          "volume",
          "strike",
          "oi",
          "spot",
        ],
        fromDate,
        toDate,
      };

      try {
        const res = await dhanRateLimitedFetch(
          "https://api.dhan.co/v2/charts/rollingoption",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "access-token": accessToken,
              "client-id": clientId,
            },
            body: JSON.stringify(requestBody),
          }
        );

        const raw = await res.text();
        let payload: any = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }

        // Dhan response shape is data.ce / data.pe.
        const node =
          side === "CALL"
            ? payload?.data?.ce ?? null
            : payload?.data?.pe ?? null;

        const timestamp = Array.isArray(node?.timestamp) ? node.timestamp : [];
        const fields = [
          "open",
          "high",
          "low",
          "close",
          "iv",
          "volume",
          "strike",
          "oi",
          "spot",
          "timestamp",
        ];

        const fieldAudit: Record<string, any> = {};
        for (const field of fields) {
          const value = node?.[field];
          fieldAudit[field] = {
            present: Array.isArray(value),
            count: Array.isArray(value) ? value.length : 0,
            first: Array.isArray(value) && value.length ? value[0] : null,
            last:
              Array.isArray(value) && value.length
                ? value[value.length - 1]
                : null,
          };
        }

        results.push({
          strike,
          side,
          httpStatus: res.status,
          ok: res.ok && Boolean(node) && timestamp.length > 0,
          candleCount: timestamp.length,
          fieldAudit,
          providerError:
            !res.ok || !node
              ? {
                  errorType: payload?.errorType ?? null,
                  errorCode: payload?.errorCode ?? null,
                  errorMessage: payload?.errorMessage ?? null,
                  rawSnippet: raw.slice(0, 300),
                }
              : null,
        });
      } catch (err) {
        results.push({
          strike,
          side,
          ok: false,
          candleCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  return c.json({
    architectureRole: "DHAN_EXPIRED_OPTIONS_30D_SAMPLE_AUDIT_V1",
    generatedAt: new Date().toISOString(),
    readOnlyMode: true,
    orderAccessUsed: false,
    tokenExposed: false,
    symbol,
    window: {
      fromDate,
      toDate,
      dhanToDateIsNonInclusive: true,
    },
    configuration: {
      intervalMinutes: 1,
      expiryFlag: "WEEK",
      expiryCode: 1,
      strikeRange: `ATM ±${strikeRange}`,
      sides: ["CALL", "PUT"],
      requiredData: [
        "open",
        "high",
        "low",
        "close",
        "iv",
        "volume",
        "strike",
        "oi",
        "spot",
      ],
    },
    totalRequests: results.length,
    passed,
    failed,
    status: failed === 0 ? "PASS" : passed > 0 ? "PARTIAL" : "FAIL",
    safeForOneYearExpansion: failed === 0,
    nextStep:
      failed === 0
        ? "Build month-chunk downloader + CSV/JSON archive."
        : "Fix failed field/strike/side calls before bulk download.",
    results,
  }, 200);
});
