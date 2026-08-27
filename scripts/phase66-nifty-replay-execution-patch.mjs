import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1";
let source = readFileSync(path, "utf8");
if (source.includes(marker)) {
  console.log(`[Phase66] ${marker} already present; no change.`);
  process.exit(0);
}

const anchor = 'app.route("/api/offline-research", offlineResearchRouter);';
if (!source.includes(anchor)) throw new Error("[Phase66] route anchor missing; refusing to patch");
if (!source.includes("function validateDataServer(")) throw new Error("[Phase66] validator missing");
if (!source.includes("function runRuleEngineServerCore(")) throw new Error("[Phase66] core rule engine missing");
if (!source.includes("nowMs: number = Date.now()")) throw new Error("[Phase66] replay clock injection missing");

const route = String.raw`

// ${marker}
// RESEARCH_ONLY / OFFLINE_REPLAY. Read-only DB queries. No broker, Telegram, execution,
// score persistence, production verdict mutation, or hindsight. Each bucket is processed
// chronologically and validated at its own minute timestamp.
app.get("/api/offline-research/nifty-deterministic-replay", async (c) => {
  const symbol = "NIFTY";
  const { dbIsConfigured, dbQuerySafe } = await import("./db.js");
  if (!dbIsConfigured()) return c.json({ version: "${marker}", readiness: "DATABASE_UNAVAILABLE" }, 503);

  const marketRows = await dbQuerySafe(\`
    SELECT minute_bucket, snapshot_id, backend_received_at, spot_ltp, spot_open, spot_high, spot_low,
           spot_prev_close, spot_vwap, spot_pdh, spot_pdl, future_ltp, future_oi, future_volume,
           future_basis, vix, vix_change
    FROM market_snapshot_1m
    WHERE symbol = $1
      AND minute_bucket IN (
        SELECT minute_bucket FROM chain_state_1m WHERE symbol = $1
        INTERSECT
        SELECT minute_bucket FROM option_snapshot_1m WHERE symbol = $1
      )
    ORDER BY minute_bucket ASC
    LIMIT 1000
  \`, [symbol]);
  if (!marketRows) return c.json({ version: "${marker}", readiness: "READ_QUERY_FAILED" }, 500);

  const chainRows = await dbQuerySafe(\`
    SELECT minute_bucket, expiry, expiry_bucket, full_chain_pcr, max_pain
    FROM chain_state_1m
    WHERE symbol = $1
    ORDER BY minute_bucket ASC, expiry ASC
  \`, [symbol]);
  if (!chainRows) return c.json({ version: "${marker}", readiness: "READ_QUERY_FAILED" }, 500);

  const chainByMinute = new Map<string, any[]>();
  for (const row of chainRows) {
    const key = new Date(row.minute_bucket).toISOString();
    const arr = chainByMinute.get(key) || [];
    arr.push(row);
    chainByMinute.set(key, arr);
  }

  const replaySession: KiteSession = {
    accessToken: "OFFLINE_REPLAY_NO_BROKER_TOKEN",
    userId: "OFFLINE_REPLAY",
    email: "",
    loginTime: 0,
    expiresAt: 0,
    snapshotHistory: [],
  };

  const blockerCounts: Record<string, number> = {};
  const verdictCounts: Record<string, number> = {};
  let validated = 0;
  let blocked = 0;
  let finiteScores = 0;
  let processed = 0;
  const samples: any[] = [];

  for (const row of marketRows) {
    const bucketIso = new Date(row.minute_bucket).toISOString();
    const chains = chainByMinute.get(bucketIso) || [];
    const currentChain = chains.find((x: any) => String(x.expiry_bucket || "").toUpperCase().includes("CURRENT")) || chains[0] || null;

    const pcr = currentChain?.full_chain_pcr == null ? null : Number(currentChain.full_chain_pcr);
    const maxPain = currentChain?.max_pain == null ? null : Number(currentChain.max_pain);
    const current = Number(row.spot_ltp);
    const dayOpen = Number(row.spot_open);
    const pdh = Number(row.spot_pdh);
    const pdl = Number(row.spot_pdl);
    const pdcClose = Number(row.spot_prev_close);
    const vwap = Number(row.spot_vwap);
    const vix = Number(row.vix);
    const vixChange = Number(row.vix_change);
    const futureLtp = Number(row.future_ltp);

    const m = {
      symbol,
      current,
      change: Number.isFinite(current) && Number.isFinite(pdcClose) ? current - pdcClose : 0,
      changePercent: Number.isFinite(current) && Number.isFinite(pdcClose) && pdcClose !== 0 ? ((current - pdcClose) / pdcClose) * 100 : 0,
      vix,
      vixChange,
      vixChangePercent: 0,
      spot: current,
      atmStrike: 0,
      vwap,
      pdh,
      pdl,
      pdcClose,
      maxPain,
      pcr,
      volumePcr: null,
      vwapSource: "RECORDED_MARKET_SNAPSHOT_1M",
      signal: "WAIT",
      futuresVwapBias: "UNKNOWN",
      futuresContracts: Number.isFinite(futureLtp) ? [{
        label: "Near", tradingsymbol: "OFFLINE_REPLAY", expiry: "", ltp: futureLtp,
        prevClose: 0, changePercent: 0, oi: row.future_oi == null ? null : Number(row.future_oi),
        volume: row.future_volume == null ? null : Number(row.future_volume), dayOpen: 0, dayHigh: 0,
        dayLow: 0, basis: row.future_basis == null ? null : Number(row.future_basis), quoteTimestamp: bucketIso
      }] : [],
      dayOpen,
      dayHigh: Number(row.spot_high),
      dayLow: Number(row.spot_low),
      first15High: 0,
      first15Low: 0,
      snapshotId: String(row.snapshot_id || bucketIso),
      exchangeTimestamp: null,
      expiries: [],
      timestamp: bucketIso,
    } as IndexMetrics;

    replaySession.snapshotHistory!.push({ timestamp: bucketIso, NIFTY: { spot: current, pcr, vix } });
    if (replaySession.snapshotHistory!.length > 5000) replaySession.snapshotHistory!.shift();

    const nowMs = new Date(bucketIso).getTime();
    const validation = validateDataServer(symbol, m, replaySession, null, nowMs);
    const result = runRuleEngineServerCore(symbol, m, validation, null);
    processed++;
    if (validation.overallValid) validated++; else blocked++;
    for (const s of validation.signals) {
      if (s.status === "NULL" || s.status === "STALE") blockerCounts[s.signal] = (blockerCounts[s.signal] || 0) + 1;
    }
    verdictCounts[result.verdict] = (verdictCounts[result.verdict] || 0) + 1;
    if (typeof result.score === "number" && Number.isFinite(result.score)) finiteScores++;
    if (samples.length < 8 || processed > Math.max(0, marketRows.length - 3)) {
      samples.push({ bucket: bucketIso, validation: { overallValid: validation.overallValid, blockingFailureCount: validation.blockingFailureCount, blockers: validation.signals.filter((s: any) => s.status === "NULL" || s.status === "STALE").map((s: any) => ({ signal: s.signal, status: s.status, reason: s.reason })) }, result: { verdict: result.verdict, score: result.score, maxScore: result.maxScore, confidence: result.confidence } });
    }
  }

  return c.json({
    version: "${marker}",
    architectureRole: "READ_ONLY_OFFLINE_DETERMINISTIC_REPLAY",
    productionImpact: "NONE",
    researchOnly: true,
    mutationAllowed: false,
    brokerCalls: false,
    telegramCalls: false,
    executionCalls: false,
    scorePersistence: false,
    symbol,
    processedBuckets: processed,
    validatedBuckets: validated,
    blockedBuckets: blocked,
    finiteScoreBuckets: finiteScores,
    blockerCounts,
    verdictCounts,
    samples,
    readiness: processed > 0 ? "REPLAY_EXECUTED" : "NO_ALIGNED_INPUT"
  });
});
`;

source = source.replace(anchor, anchor + route);

for (const forbidden of ["placeOrder(", "sendTelegram", "persistKnownThenScoreObservation(", "dbInsert("]) {
  if (route.includes(forbidden)) throw new Error(`[Phase66] forbidden side effect detected: ${forbidden}`);
}
if (!route.includes("validateDataServer(symbol, m, replaySession, null, nowMs)")) throw new Error("[Phase66] exact validator clock call missing");
if (!route.includes("runRuleEngineServerCore(symbol, m, validation, null)")) throw new Error("[Phase66] core engine call missing");
writeFileSync(path, source, "utf8");
console.log(`[Phase66] Applied ${marker}`);
