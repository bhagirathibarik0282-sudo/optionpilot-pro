import { canonicalPcrProjectionSql } from './h1-replay-canonical-projection.js';
import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { standardIndexObservationClose } from './index-observation-session.js';

export const H1_REPLAY_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
export type H1ReplaySymbol = (typeof H1_REPLAY_SYMBOLS)[number];
export type H1ReplayScope = "CORE" | "FULL";

export interface H1ReplayRequest {
  symbol: H1ReplaySymbol;
  tradeDate: string;
  fromTime: string;
  toTime: string;
  scope: H1ReplayScope;
}

export interface H1ReplayMarkerGapEvidence {
  semantics: "RAW_NORMALIZED_TABLE_PRESENCE_WITHOUT_TRUTH_MARKER_JOIN";
  markerJoinBypassedForInspection: true;
  buckets: Array<{
    minuteBucket: string;
    marketRows: number;
    optionRows: number;
    chainRows: number;
  }>;
  writePerformed: false;
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

export interface H1ReplayHttpResult {
  ok: boolean;
  mode: "READ_ONLY_H1_3M_REPLAY";
  productionImpact: "NONE";
  request: H1ReplayRequest | null;
  counts?: { market: number; options: number; chain: number; markers: number; canonical: number };
  market?: Record<string, unknown>[];
  options?: Record<string, unknown>[];
  chain?: Record<string, unknown>[];
  canonical?: Record<string, unknown>[];
  continuity?: H1ReplayContinuity;
  markerGapEvidence?: H1ReplayMarkerGapEvidence;
  /** Read durations include waiting for the existing connection pool. */
  queryTimingsMs?: Record<string, number>;
  reason?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:0\d|1\d|2[0-3]):[0-5]\d$/;

function validCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timeMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function parseH1ReplayRequest(input: {
  symbol?: string | null;
  tradeDate?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
  scope?: string | null;
}): { ok: true; value: H1ReplayRequest } | { ok: false; reason: string } {
  const symbol = String(input.symbol ?? "NIFTY").trim().toUpperCase();
  if (!H1_REPLAY_SYMBOLS.includes(symbol as H1ReplaySymbol)) {
    return { ok: false, reason: "INVALID_SYMBOL" };
  }

  const tradeDate = String(input.tradeDate ?? "").trim();
  if (!validCalendarDate(tradeDate)) return { ok: false, reason: "INVALID_TRADE_DATE" };

  const fromTime = String(input.fromTime ?? "09:15").trim();
  const sessionClose = standardIndexObservationClose(tradeDate);
  const toTime = String(input.toTime ?? sessionClose).trim();
  if (!TIME_RE.test(fromTime) || !TIME_RE.test(toTime)) return { ok: false, reason: "INVALID_TIME_RANGE" };
  if (timeMinutes(fromTime) > timeMinutes(toTime)) return { ok: false, reason: "INVALID_TIME_RANGE" };

  const marketOpen = timeMinutes("09:15");
  const marketClose = timeMinutes(sessionClose);
  if (timeMinutes(fromTime) < marketOpen || timeMinutes(toTime) > marketClose) {
    return { ok: false, reason: "OUTSIDE_MARKET_SESSION" };
  }

  const scope = String(input.scope ?? "CORE").trim().toUpperCase();
  if (scope !== "CORE" && scope !== "FULL") return { ok: false, reason: "INVALID_SCOPE" };

  return {
    ok: true,
    value: {
      symbol: symbol as H1ReplaySymbol,
      tradeDate,
      fromTime,
      toTime,
      scope: scope as H1ReplayScope,
    },
  };
}

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const result = await dbQuerySafe<T>(sql, params);
  if (!result) throw new Error("H1_REPLAY_DB_QUERY_FAILED");
  return result.rows;
}

export interface H1ReplayContinuity {
  cadenceMinutes: 1 | 3;
  expectedBuckets: number;
  observedMarkerBuckets: number;
  missingBuckets: string[];
  firstObserved: string | null;
  lastObserved: string | null;
  coveragePct: number;
  complete: boolean;
  truthCounts: Record<string, number>;
  canonicalArchiveBuckets: number;
  canonicalCoveragePct: number;
  allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB";
}

function expectedBucketIsos(request: H1ReplayRequest): string[] {
  const start = Date.parse(`${request.tradeDate}T${request.fromTime}:00+05:30`);
  const end = Date.parse(`${request.tradeDate}T${request.toTime}:00+05:30`);
  const out: string[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return out;
  for (let t = start; t <= end; t += (request.tradeDate >= "2026-10-19" ? 1 : 3) * 60_000) out.push(new Date(t).toISOString());
  return out;
}

export function buildH1ReplayContinuity(
  request: H1ReplayRequest,
  markerRows: Array<{ minute_bucket: unknown; truth_verdict: unknown }>,
  canonicalRows: Array<{ minute_bucket: unknown }>,
): H1ReplayContinuity {
  const expected = expectedBucketIsos(request);
  const observed = new Set(
    markerRows
      .map((r) => {
        const t = Date.parse(String(r.minute_bucket ?? ""));
        return Number.isFinite(t) ? new Date(t).toISOString() : null;
      })
      .filter((v): v is string => v !== null),
  );
  const canonical = new Set(
    canonicalRows
      .map((r) => {
        const t = Date.parse(String(r.minute_bucket ?? ""));
        return Number.isFinite(t) ? new Date(t).toISOString() : null;
      })
      .filter((v): v is string => v !== null),
  );
  const missingBuckets = expected.filter((x) => !observed.has(x));
  const observedSorted = [...observed].sort();
  const truthCounts: Record<string, number> = {};
  for (const row of markerRows) {
    const k = String(row.truth_verdict ?? "UNKNOWN");
    truthCounts[k] = (truthCounts[k] ?? 0) + 1;
  }
  const observedExpectedCount = expected.filter((x) => observed.has(x)).length;
  const canonicalExpectedCount = expected.filter((x) => canonical.has(x)).length;
  const coveragePct = expected.length ? (observedExpectedCount / expected.length) * 100 : 0;
  const canonicalCoveragePct = expected.length ? (canonicalExpectedCount / expected.length) * 100 : 0;
  return {
    cadenceMinutes: request.tradeDate >= "2026-10-19" ? 1 : 3,
    expectedBuckets: expected.length,
    observedMarkerBuckets: observed.size,
    missingBuckets,
    firstObserved: observedSorted[0] ?? null,
    lastObserved: observedSorted[observedSorted.length - 1] ?? null,
    coveragePct,
    complete: expected.length > 0 && missingBuckets.length === 0,
    truthCounts,
    canonicalArchiveBuckets: canonical.size,
    canonicalCoveragePct,
    allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB",
  };
}

type RawGapRow = { source: "market" | "option" | "chain"; minute_bucket: unknown; row_count: string | number };

function minuteIso(value: unknown): string | null {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function buildH1ReplayMarkerGapEvidence(
  missingBuckets: string[],
  rawRows: RawGapRow[],
): H1ReplayMarkerGapEvidence {
  const byBucket = new Map<string, { marketRows: number; optionRows: number; chainRows: number }>();
  for (const row of rawRows ?? []) {
    const minuteBucket = minuteIso(row.minute_bucket);
    if (!minuteBucket) continue;
    const item = byBucket.get(minuteBucket) ?? { marketRows: 0, optionRows: 0, chainRows: 0 };
    const count = Number(row.row_count);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
    if (row.source === "market") item.marketRows += safeCount;
    if (row.source === "option") item.optionRows += safeCount;
    if (row.source === "chain") item.chainRows += safeCount;
    byBucket.set(minuteBucket, item);
  }

  return {
    semantics: "RAW_NORMALIZED_TABLE_PRESENCE_WITHOUT_TRUTH_MARKER_JOIN",
    markerJoinBypassedForInspection: true,
    buckets: (missingBuckets ?? []).map((minuteBucket) => ({
      minuteBucket,
      ...(byBucket.get(minuteBucket) ?? { marketRows: 0, optionRows: 0, chainRows: 0 }),
    })),
    writePerformed: false,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

/** Canonical archive reader: decode metadata once per archive row. Raw market
 * JSON is extracted only for selected rows, retaining absent vs explicit null.
 * No created_at fence, new index, deduplication or source-time substitution.
 */
export function canonicalReplayReadSql(canonicalPcrOnly=false):string {
  return `${canonicalPcrOnly?'WITH replay_archive AS MATERIALIZED (':''}
    SELECT p."minuteBucket"::timestamptz AS minute_bucket,
      p.symbol AS symbol, p."snapshotId" AS snapshot_id,
      p."truthVerdict" AS truth_verdict, p."sourceTimestamp" AS source_timestamp,
      p."calculationVersion" AS calculation_version,
      ${canonicalPcrOnly?"payload->'market' AS raw_market":"payload->'market' AS market"}
    FROM app_state_log
    CROSS JOIN LATERAL jsonb_to_record(
      CASE WHEN jsonb_typeof(payload)='object' THEN payload ELSE '{}'::jsonb END
    ) AS p("minuteBucket" text, symbol text, "snapshotId" text,
      "truthVerdict" text, "sourceTimestamp" text, "calculationVersion" text)
    WHERE kind = 'H1_CANONICAL_MARKET_ARCHIVE'
      AND p.symbol = $1 AND p."minuteBucket" IS NOT NULL
      AND ((p."minuteBucket"::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
      AND ((p."minuteBucket"::timestamptz AT TIME ZONE 'Asia/Kolkata')::time >= $3::time)
      AND ((p."minuteBucket"::timestamptz AT TIME ZONE 'Asia/Kolkata')::time <= $4::time)
    ORDER BY p."minuteBucket"::timestamptz ASC
    ${canonicalPcrOnly?`) SELECT minute_bucket, symbol, snapshot_id, truth_verdict,
      source_timestamp, calculation_version, ${canonicalPcrProjectionSql('raw_market')} AS market
      FROM replay_archive ORDER BY minute_bucket ASC`:''}`;
}

function markerCte(): string {
  return `WITH markers AS (
    SELECT DISTINCT ON (payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz))
      payload->>'symbol' AS symbol,
      date_trunc('minute', (payload->>'minuteBucket')::timestamptz) AS minute_bucket,
      payload->>'truthVerdict' AS truth_verdict,
      created_at
    FROM app_state_log
    WHERE kind = 'H1_TRUTH_MARKER'
      AND payload->>'symbol' = $1
      AND payload->>'minuteBucket' IS NOT NULL
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time >= $3::time)
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time <= $4::time)
    ORDER BY payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC
  )`;
}

export async function runH1ReplayHttp(request: H1ReplayRequest, canonicalPcrOnly = false): Promise<H1ReplayHttpResult> {
  if (!dbIsConfigured()) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request,
      reason: "DATABASE_URL_NOT_CONFIGURED",
    };
  }

  return runH1ReplayRead(request, rows, canonicalPcrOnly);
}

/** One truth-marker read per request, frozen for all three normalized tables.
 * The injectable reader is used by tests, never accepted from an HTTP caller.
 * No result cache, source-time substitution, schema change or write authority.
 */
export async function runH1ReplayRead(request: H1ReplayRequest, read: typeof rows, canonicalPcrOnly = false): Promise<H1ReplayHttpResult> {
  const params = [request.symbol, request.tradeDate, request.fromTime, request.toTime];
  const queryTimingsMs: Record<string, number> = {};
  const timedRows = async <T extends Record<string, unknown>>(label: string, sql: string, values: unknown[]): Promise<T[]> => {
    const started = performance.now();
    try { return await read<T>(sql, values); }
    finally { queryTimingsMs[label] = Math.round((performance.now() - started) * 10) / 10; }
  };

  try {
    const markerRows = await timedRows<{ minute_bucket: unknown; truth_verdict: unknown }>("markers",
      `${markerCte()} SELECT minute_bucket, truth_verdict FROM markers ORDER BY minute_bucket ASC`, params);
    const cte = `WITH markers AS (
      SELECT $1::text AS symbol, r.minute_bucket, r.truth_verdict
      FROM jsonb_to_recordset($2::jsonb) AS r(minute_bucket timestamptz, truth_verdict text)
    )`;
    const tableParams = [request.symbol, JSON.stringify(markerRows),
      request.tradeDate+'T'+request.fromTime+':00+05:30', request.tradeDate+'T'+request.toTime+':00+05:30'];
    const normalized = <T extends Record<string, unknown>>(label: string, sql: string, values: unknown[]) => {
      if (markerRows.length) return timedRows<T>(label, sql, values);
      queryTimingsMs[label] = 0;
      return Promise.resolve([] as T[]);
    };
    const [market, chain, options, canonical] = await Promise.all([
      normalized("market", `${cte}
        SELECT
          m.symbol, m.minute_bucket, h.truth_verdict,
          m.snapshot_id, m.exchange_timestamp, m.backend_timestamp, m.freshness_status,
          m.spot_ltp, m.spot_open, m.spot_high, m.spot_low, m.spot_prev_close,
          m.vwap, m.pdh, m.pdl, m.gap_percent,
          m.future_ltp, m.future_vwap, m.future_oi, m.future_oi_change, m.future_volume, m.future_basis,
          m.india_vix, m.india_vix_change, m.calculation_version
        FROM market_snapshot_1m m
        JOIN markers h ON h.symbol = m.symbol AND h.minute_bucket = m.minute_bucket
        WHERE m.symbol = $1 AND m.minute_bucket >= $3::timestamptz AND m.minute_bucket <= $4::timestamptz
        ORDER BY m.minute_bucket ASC`, tableParams),
      normalized("chain", `${cte}
        SELECT
          c.symbol, c.minute_bucket, h.truth_verdict,
          c.expiry, c.expiry_bucket, c.atm_strike,
          c.full_chain_oi_pcr, c.band7_oi_pcr, c.volume_pcr, c.max_pain,
          c.call_wall_strike, c.call_wall_oi, c.call_wall_strength, c.call_wall_distance, c.call_wall_migration,
          c.put_wall_strike, c.put_wall_oi, c.put_wall_strength, c.put_wall_distance, c.put_wall_migration,
          c.atm_iv, c.straddle_ltp, c.straddle_change,
          c.validation_status, c.calculation_version
        FROM chain_state_1m c
        JOIN markers h ON h.symbol = c.symbol AND h.minute_bucket = c.minute_bucket
        WHERE c.symbol = $1 AND c.minute_bucket >= $3::timestamptz AND c.minute_bucket <= $4::timestamptz
        ORDER BY c.minute_bucket ASC, c.expiry ASC`, tableParams),
      normalized("options", `${cte}
        SELECT
          o.symbol, o.minute_bucket, h.truth_verdict,
          o.snapshot_id, o.expiry, o.expiry_bucket, o.dte,
          o.strike, o.option_type, o.atm_offset, o.is_candidate, o.is_wall,
          o.ltp, o.bid, o.ask, o.spread, o.volume, o.oi, o.oi_change,
          o.derived_oi_change, o.derived_oi_change_source, o.derived_oi_change_gap_seconds,
          o.iv, o.delta, o.gamma, o.vega, o.theta, o.intrinsic, o.extrinsic,
          o.day_high, o.day_low, o.pdh, o.pdl,
          o.quote_timestamp, o.quote_age_seconds,
          o.liquidity_status, o.validation_status, o.calculation_version
        FROM option_snapshot_1m o
        JOIN markers h ON h.symbol = o.symbol AND h.minute_bucket = o.minute_bucket
        WHERE o.symbol = $1 AND o.minute_bucket >= $3::timestamptz AND o.minute_bucket <= $4::timestamptz
          AND ($5::text = 'FULL' OR o.atm_offset BETWEEN -7 AND 7)
        ORDER BY o.minute_bucket ASC, o.expiry ASC, o.strike ASC, o.option_type ASC`, [...tableParams, request.scope]),
      timedRows<Record<string, unknown>>("canonical", canonicalReplayReadSql(canonicalPcrOnly), params),
    ]);

    const continuity = buildH1ReplayContinuity(request, markerRows, canonical);
    // Raw normalized counts are only observable for missing marker buckets.
    // A complete marker grid needs no additional full-table presence audit.
    const rawGapRows = continuity.missingBuckets.length
      ? await timedRows<RawGapRow>("raw_gaps", `
        SELECT 'market'::text AS source, minute_bucket, COUNT(*)::bigint AS row_count
        FROM market_snapshot_1m
        WHERE symbol = $1
          AND minute_bucket >= (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata')
          AND minute_bucket <= (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata')
        GROUP BY minute_bucket
        UNION ALL
        SELECT 'option'::text AS source, minute_bucket, COUNT(*)::bigint AS row_count
        FROM option_snapshot_1m
        WHERE symbol = $1
          AND minute_bucket >= (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata')
          AND minute_bucket <= (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata')
        GROUP BY minute_bucket
        UNION ALL
        SELECT 'chain'::text AS source, minute_bucket, COUNT(*)::bigint AS row_count
        FROM chain_state_1m
        WHERE symbol = $1
          AND minute_bucket >= (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata')
          AND minute_bucket <= (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata')
        GROUP BY minute_bucket
        ORDER BY minute_bucket ASC
      `, params)
      : [];
    if (!continuity.missingBuckets.length) queryTimingsMs.raw_gaps = 0;
    const markerGapEvidence = buildH1ReplayMarkerGapEvidence(continuity.missingBuckets, rawGapRows);

    return {
      ok: true,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request,
      counts: {
        market: market.length,
        options: options.length,
        chain: chain.length,
        markers: markerRows.length,
        canonical: canonical.length,
      },
      market,
      options,
      chain,
      canonical,
      continuity,
      markerGapEvidence,
      queryTimingsMs,
    };
  } catch (err) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request,
      queryTimingsMs,
      reason: err instanceof Error ? err.message : "H1_REPLAY_FAILED",
    };
  }
}
