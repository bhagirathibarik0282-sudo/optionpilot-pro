import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { derivePremiumDeltaPair } from "./premium-workspace-model.js";
import { evaluateSpreadTheory, parseSpreadTheory, qualifySpreadRows } from "./spread-theory-backtest.js";

/**
 * Recorded, same-absolute-Delta CE/PE selection.
 * Select at the FIRST QUALIFIED early bucket; LOCK two contract identities all day.
 * Same-Delta does not make CE-minus-PE Delta-neutral: signed Delta difference ~1.
 * The spot-adjusted residual is first-order research only, NOT a trade prediction.
 */
type Raw = Record<string, unknown>;
type Pair = { expiry: string; ceStrike: number; peStrike: number;
  ceDelta: number; peDelta: number; anchorBucket: string; snapshotId: string };
const SEC = 1000;
const safety = { readOnly: true, writesPerformed: false, brokerRequests: false,
  affectsSelector: false, affectsVerdict: false, affectsTelegram: false,
  affectsExecution: false, createsOrders: false } as const;
const number = (v: unknown): number | null => v == null || v === "" ||
  !Number.isFinite(Number(v)) ? null : Number(v);
const positive = (v: unknown) => { const n = number(v); return n != null && n > 0 ? n : null; };
const time = (v: unknown) => Date.parse(String(v ?? ""));
const ist = (date: string, clock: string) => new Date(date + "T" + clock + ":00+05:30").toISOString();
const round = (n: number) => Number(n.toFixed(3));

export function parseDeltaTarget(target: unknown) {
  const n = target == null || target === "" ? 0.5 : number(target);
  return n === 0.25 || n === 0.4 || n === 0.5 ? n : null;
}
/** Pure candidate matcher; reuse the dashboard's exact recorded Delta tolerances.
 * All raw identities are retained even if withheld, so duplicates cannot
 * disappear through filtering and become falsely eligible.
 */
export function selectRecordedDeltaAnchor(rows: Raw[], symbol: string, expiry: string, target: number): Pair | null {
  const buckets = new Map<number, Raw[]>();
  for (const r of rows) {
    if (r.symbol !== symbol || String(r.expiry).slice(0, 10) !== expiry) continue;
    const t = time(r.minute_bucket);
    if (!Number.isFinite(t)) continue;
    const bucket = buckets.get(t) ?? []; bucket.push(r); buckets.set(t, bucket);
  }
  for (const [bucketTime, raw] of [...buckets].sort(([a], [b]) => a - b)) {
    const mapped = raw.map(r => {
      const quoteAt = time(r.quote_timestamp), quoteAge = number(r.quote_age_seconds);
      const side = r.option_type, d = number(r.delta), p = positive(r.ltp);
      const valid = r.truth_verdict === "TRUE" &&
        r.market_snapshot_id != null && r.snapshot_id === r.market_snapshot_id &&
        r.validation_status === "RESEARCH_ELIGIBLE" &&
        p != null && d != null && Number.isFinite(quoteAt) &&
        quoteAt >= bucketTime && quoteAt < bucketTime + 60 * SEC &&
        quoteAge != null && quoteAge >= 0 && quoteAge <= 30 &&
        (side === "CE" ? d > 0 && d <= 1 : side === "PE" && d < 0 && d >= -1);
      return {
        key: [symbol, expiry, r.strike, side].join("|"),
        symbol, expiry, dte: number(r.dte), strike: number(r.strike),
        type: side, at: new Date(bucketTime).toISOString(),
        observedAt: new Date(quoteAt).toISOString(),
        state: valid ? "RECORDED" : "WITHHELD",
        price: valid ? p : null, delta: valid ? d : null,
        snapshotId: r.snapshot_id,
      };
    });
    const pair = derivePremiumDeltaPair(mapped, target, "RECORDED");
    if (pair.matched && pair.CE.snapshotId === pair.PE.snapshotId) {
      return { expiry, ceStrike: pair.CE.strike, peStrike: pair.PE.strike,
        ceDelta: pair.CE.delta, peDelta: pair.PE.delta,
        anchorBucket: new Date(bucketTime).toISOString(), snapshotId: pair.CE.snapshotId };
    }
  }
  return null;
}

async function read(sql: string, params: unknown[]): Promise<Raw[]> {
  const result = await dbQuerySafe<Raw>(sql, params);
  if (!result) throw new Error("RECORDED_DATA_UNAVAILABLE");
  return result.rows;
}
const expirySql = [
  "SELECT expiry::text FROM option_snapshot_1m",
  "WHERE symbol=$1 AND minute_bucket BETWEEN $2::timestamptz AND $3::timestamptz",
  "AND expiry >= $4::date ORDER BY expiry ASC LIMIT 1",
].join(" ");

const anchorSql = [
  "WITH markers AS (",
  "SELECT DISTINCT ON (date_trunc('minute', (payload->>'minuteBucket')::timestamptz))",
  "date_trunc('minute', (payload->>'minuteBucket')::timestamptz) AS bucket,",
  "payload->>'truthVerdict' AS truth_verdict",
  "FROM app_state_log WHERE kind='H1_TRUTH_MARKER' AND payload->>'symbol'=$1",
  "AND (payload->>'minuteBucket')::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz",
  "ORDER BY date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC)",
  "SELECT o.symbol,o.expiry,o.dte,o.strike,o.option_type,o.minute_bucket,",
  "o.ltp,o.delta,o.validation_status,o.quote_timestamp,o.quote_age_seconds,",
  "o.snapshot_id,m.snapshot_id AS market_snapshot_id,markers.truth_verdict",
  "FROM option_snapshot_1m o",
  "JOIN market_snapshot_1m m ON m.symbol=o.symbol AND m.minute_bucket=o.minute_bucket",
  "LEFT JOIN markers ON markers.bucket=o.minute_bucket",
  "WHERE o.symbol=$1 AND o.minute_bucket BETWEEN $2::timestamptz AND $3::timestamptz",
  "AND o.expiry=$4::date AND o.option_type IN ('CE','PE')",
  "ORDER BY o.minute_bucket ASC,o.strike ASC,o.option_type ASC",
].join(" ");

const trajectorySql = [
  "WITH markers AS (SELECT DISTINCT ON (date_trunc('minute',(payload->>'minuteBucket')::timestamptz))",
  "date_trunc('minute',(payload->>'minuteBucket')::timestamptz) AS bucket,",
  "payload->>'truthVerdict' AS truth_verdict FROM app_state_log",
  "WHERE kind='H1_TRUTH_MARKER' AND payload->>'symbol'=$1",
  "AND (payload->>'minuteBucket')::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz",
  "ORDER BY date_trunc('minute',(payload->>'minuteBucket')::timestamptz),created_at DESC)",
  "SELECT m.minute_bucket,m.spot_ltp,m.snapshot_id AS market_snapshot_id,markers.truth_verdict,",
  "ce.ltp AS ce_ltp,ce.snapshot_id AS ce_snapshot_id,",
  "ce.validation_status AS ce_validation_status,ce.quote_timestamp AS ce_quote_timestamp,",
  "ce.quote_age_seconds AS ce_quote_age_seconds,",
  "pe.ltp AS pe_ltp,pe.snapshot_id AS pe_snapshot_id,",
  "pe.validation_status AS pe_validation_status,pe.quote_timestamp AS pe_quote_timestamp,",
  "pe.quote_age_seconds AS pe_quote_age_seconds",
  "FROM market_snapshot_1m m LEFT JOIN markers ON markers.bucket=m.minute_bucket",
  "LEFT JOIN option_snapshot_1m ce ON ce.symbol=m.symbol AND ce.minute_bucket=m.minute_bucket",
  "AND ce.expiry=$4::date AND ce.strike=$5::integer AND ce.option_type='CE'",
  "LEFT JOIN option_snapshot_1m pe ON pe.symbol=m.symbol AND pe.minute_bucket=m.minute_bucket",
  "AND pe.expiry=$4::date AND pe.strike=$6::integer AND pe.option_type='PE'",
  "WHERE m.symbol=$1 AND m.minute_bucket BETWEEN $2::timestamptz AND $3::timestamptz",
  "ORDER BY m.minute_bucket ASC",
].join(" ");

async function runDay(symbol: string, date: string, target: number) {
  const scope = [symbol, ist(date, "09:15"), ist(date, "15:30")];
  const anchorEnd = ist(date, "10:00");
  // Earliest observed expiry. No auto-roll or later expiry substituted if Greeks missing.
  const firstExpiry = await read(expirySql, [symbol, scope[1], anchorEnd, date]);
  if (!firstExpiry.length) return { date, status: "NO_RECORDED_EXPIRY" };
  const expiry = String(firstExpiry[0].expiry).slice(0, 10);
  const options = await read(anchorSql, [symbol, scope[1], anchorEnd, expiry]);
  const pair = selectRecordedDeltaAnchor(options, symbol, expiry, target);
  if (!pair) return { date, expiry, status: "NO_VERIFIED_SAME_DELTA_PAIR",
    inspectedOptionRows: options.length, anchorWindowIst: "09:15-10:00" };
  const trajectory = await read(trajectorySql,
    [...scope, pair.expiry, pair.ceStrike, pair.peStrike]);
  const { points, contextPoints, excludedBuckets, diagnosticBuckets, observedBuckets } = qualifySpreadRows(trajectory);
  const cadence = date >= "2026-10-19" ? 1 : 3;
  const raw = evaluateSpreadTheory(points, cadence);
  const diagnostic = evaluateSpreadTheory(contextPoints, cadence);
  // Anchor is selected from the first valid pair. Do not use earlier prices
  // or choose a better-performing anchor with knowledge of future outcomes.
  const accepted = points.filter(p => p.minute >= pair.anchorBucket);
  const anchor = accepted[0];
  const beta = pair.ceDelta - pair.peDelta; // ≈1 for |Delta| matched CE-minus-PE.
  const residual = anchor ? accepted.map(p => ({
    ...p, gap: round((p.gap - anchor.gap) - beta * (p.spot - anchor.spot)),
  })) : [];
  const adjusted = evaluateSpreadTheory(residual, cadence);
  return { date, status: accepted.length ? "OBSERVED" : "NO_STRICT_RESEARCH_SAMPLES",
    targetAbsDelta: target,
    fixedPair: pair,
    firstEligibleMinute: anchor?.minute ?? null,
    observedMinuteBuckets: observedBuckets, excludedMinuteBuckets: excludedBuckets,
    diagnosticMinuteBuckets: diagnosticBuckets,
    qualifyingMinutesFromAnchor: accepted.length,
    rawSpread: raw,
    spotAdjustedResidual: { name: "FIRST_ORDER_DELTA_ADJUSTED_CE_MINUS_PE",
      betaAtAnchor: beta, basedOn: "FIXED_MATCHED_ENTRY_DELTAS_NOT_REALIZED_RETURN",
      firstOrderOnly: true, ...adjusted },
    diagnosticCrossoverContext: { label: "TRUE_DIAGNOSTIC_NOT_RESEARCH_PROOF",
      crossovers: diagnostic.crossovers, events: diagnostic.events },
  };
}

export async function runDeltaSpreadBacktest(q: { symbol?: string; dates?: string; target?: string }) {
  const parsed = parseSpreadTheory(q), target = parseDeltaTarget(q.target);
  if (!parsed.ok) return { status: 400 as const, json: { ok: false, reason: parsed.reason, safety } };
  if (target === null) return { status: 400 as const,
    json: { ok: false, reason: "TARGET_MUST_BE_0.25_0.40_0.50", safety } };
  if (!dbIsConfigured()) return { status: 503 as const,
    json: { ok: false, reason: "DATABASE_URL_NOT_CONFIGURED", safety } };
  const days = [];
  for (const date of parsed.dates) {
    try { days.push(await runDay(parsed.symbol, date, target)); }
    catch { days.push({ date, status: "RECORDED_RESEARCH_READ_UNAVAILABLE" }); }
  }
  return { status: 200 as const, json: {
    ok: true, mode: "READ_ONLY_SAME_DELTA_SPREAD_BACKTEST_V1",
    symbol: parsed.symbol, dates: parsed.dates, targetAbsDelta: target,
    selection: "EARLIEST_RESEARCH_ELIGIBLE_SAME_EXPIRY_ABS_DELTA_PAIR_BEFORE_10AM",
    lockedContracts: true, pairTolerance: { eachTargetErrorMax: 0.05, absDeltaDifferenceMax: 0.02 },
    cadence: "EXACT_3M_PRE_2026_10_19_ELSE_1M_NO_INTERPOLATION",
    comparison: "RAW_CE_MINUS_PE_AND_SPOT_ADJUSTED_RESIDUAL_VS_SPOT_MOMENTUM_BASELINE",
    limitations: ["RESEARCH_ONLY_NOT_WIN_RATE", "NO_CROSS_CONTRACT_ROLL_RETURN",
      "SAME_ABS_DELTA_RAW_SPREAD_IS_NOT_DELTA_NEUTRAL",
      "DELTA_ACCURACY_IS_ARCHIVE_DEPENDENT", "NO_CAUSAL_OR_EXECUTION_CLAIMS"],
    days, safety,
  } };
}
