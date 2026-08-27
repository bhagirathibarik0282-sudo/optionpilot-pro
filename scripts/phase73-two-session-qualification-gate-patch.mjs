import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const anchor = 'app.get("/api/research/shadow-diagnostic-trace"';
const idx = src.indexOf(anchor);
if (idx < 0) throw new Error("shadow diagnostic anchor missing");
if (src.includes("PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1")) {
  console.log("Phase73 gate already present");
  process.exit(0);
}

const route = `// PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1
// READ_ONLY qualification evidence gate. Offline replay NEVER counts as a live session.
app.get("/api/research/two-session-qualification-gate", async (c) => {
  const supportedSymbols = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
  try {
    const { dbIsConfigured, dbQuerySafe } = await import("./db.js");
    if (!dbIsConfigured()) {
      return c.json({
        version: "PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1",
        productionImpact: "NONE",
        automaticPromotionAllowed: false,
        offlineReplayCountsAsLive: false,
        state: "DATABASE_UNAVAILABLE",
        qualified: false,
      }, 503);
    }

    const q = await dbQuerySafe<any>(\`
      SELECT
        (observed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS session_date,
        symbol,
        COUNT(*)::int AS observations,
        MIN(observed_at) AS first_observed_at,
        MAX(observed_at) AS last_observed_at
      FROM score_observation_known_then
      WHERE known_then = TRUE
        AND source_path = 'server:runRuleEngineServer'
        AND symbol = ANY($1::text[])
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    \`, [supportedSymbols]);

    if (!q || !Array.isArray(q.rows)) {
      return c.json({
        version: "PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1",
        productionImpact: "NONE",
        automaticPromotionAllowed: false,
        offlineReplayCountsAsLive: false,
        state: "LIVE_EVIDENCE_QUERY_UNAVAILABLE",
        qualified: false,
      });
    }

    const byDate = new Map<string, any[]>();
    for (const row of q.rows) {
      const date = String(row.session_date || "");
      if (!date) continue;
      const arr = byDate.get(date) || [];
      arr.push({
        symbol: String(row.symbol),
        observations: Number(row.observations || 0),
        firstObservedAt: row.first_observed_at ? new Date(row.first_observed_at).toISOString() : null,
        lastObservedAt: row.last_observed_at ? new Date(row.last_observed_at).toISOString() : null,
      });
      byDate.set(date, arr);
    }

    const sessions = [...byDate.entries()].map(([sessionDate, rows]) => {
      const symbols = rows.map((r) => r.symbol);
      const allSymbolsPresent = supportedSymbols.every((s) => symbols.includes(s));
      return { sessionDate, allSymbolsPresent, symbols, evidence: rows };
    });
    const fullCoverageSessions = sessions.filter((s) => s.allSymbolsPresent);
    const evidenceState = fullCoverageSessions.length >= 2
      ? "TWO_LIVE_SESSIONS_EVIDENCED"
      : fullCoverageSessions.length === 1
        ? "ONE_LIVE_SESSION_EVIDENCED"
        : sessions.length > 0
          ? "PARTIAL_LIVE_SESSION_EVIDENCE"
          : "NO_LIVE_SESSION_EVIDENCE";

    return c.json({
      version: "PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1",
      architectureRole: "READ_ONLY_LIVE_QUALIFICATION_EVIDENCE",
      productionImpact: "NONE",
      automaticPromotionAllowed: false,
      offlineReplayCountsAsLive: false,
      requiredLiveSessions: 2,
      supportedSymbols,
      observedSessionCount: sessions.length,
      fullCoverageSessionCount: fullCoverageSessions.length,
      sessions,
      state: evidenceState,
      qualified: false,
      qualificationNote: fullCoverageSessions.length >= 2
        ? "Evidence threshold reached; final clean-session review is still required before controlled forward testing."
        : "Two independent live sessions have not yet been evidenced.",
    });
  } catch (err) {
    console.error("[PHASE73_QUALIFICATION_GATE]", err instanceof Error ? err.message : err);
    return c.json({
      version: "PHASE73_TWO_SESSION_QUALIFICATION_GATE_V1",
      productionImpact: "NONE",
      automaticPromotionAllowed: false,
      offlineReplayCountsAsLive: false,
      state: "RUNTIME_FAILED",
      qualified: false,
    }, 500);
  }
});

`;

for (const forbidden of ["placeOrder(", "sendTelegram", "persistKnownThenScoreObservation(", "dbInsert("]) {
  if (route.includes(forbidden)) throw new Error(`forbidden Phase73 side effect: ${forbidden}`);
}
for (const required of ["offlineReplayCountsAsLive: false", "automaticPromotionAllowed: false", "source_path = 'server:runRuleEngineServer'", "requiredLiveSessions: 2"]) {
  if (!route.includes(required)) throw new Error(`Phase73 invariant missing: ${required}`);
}

src = src.slice(0, idx) + route + src.slice(idx);
fs.writeFileSync(path, src);
console.log("Phase73 two-session qualification evidence gate applied");
