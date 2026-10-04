import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { H1_REPLAY_SYMBOLS, type H1ReplaySymbol } from "./h1-replay-http.js";

export type H1OptionType = "CE" | "PE";

export interface H1FixedContractJourneyRequest {
  symbol: H1ReplaySymbol;
  expiry: string;
  strike: number;
  optionType: H1OptionType;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
}

export interface H1FixedContractJourneyCoverage {
  semantics: "EXACT_CONTRACT_PRESENCE_ACROSS_EXISTING_H1_TRUTH_MARKERS";
  markerBuckets: number;
  contractBuckets: number;
  coveredMarkerBuckets: number;
  missingContractBuckets: string[];
  unmarkedContractBuckets: string[];
  coveragePct: number;
  complete: boolean;
}

export interface H1FixedContractJourneyResult {
  ok: boolean;
  available: boolean;
  mode: "READ_ONLY_FIXED_CONTRACT_JOURNEY_V1";
  productionImpact: "NONE";
  request: H1FixedContractJourneyRequest | null;
  coverage?: H1FixedContractJourneyCoverage;
  rows?: Record<string, unknown>[];
  reason?: string;
  safety: {
    readOnly: true;
    writesPerformed: false;
    affectsSelector: false;
    affectsTelegram: false;
    affectsExecution: false;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:0\d|1\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 45;

const SAFETY = {
  readOnly: true,
  writesPerformed: false,
  affectsSelector: false,
  affectsTelegram: false,
  affectsExecution: false,
} as const;

function calendarDateMs(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function parseH1FixedContractJourneyRequest(input: {
  symbol?: string | null;
  expiry?: string | null;
  strike?: string | number | null;
  optionType?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
}): { ok: true; value: H1FixedContractJourneyRequest } | { ok: false; reason: string } {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!H1_REPLAY_SYMBOLS.includes(symbol as H1ReplaySymbol)) return { ok: false, reason: "INVALID_SYMBOL" };

  const expiry = String(input.expiry ?? "").trim();
  if (calendarDateMs(expiry) === null) return { ok: false, reason: "INVALID_EXPIRY" };

  const strike = Number(input.strike);
  if (!Number.isSafeInteger(strike) || strike <= 0 || strike > 1_000_000) {
    return { ok: false, reason: "INVALID_STRIKE" };
  }

  const optionType = String(input.optionType ?? "").trim().toUpperCase();
  if (optionType !== "CE" && optionType !== "PE") return { ok: false, reason: "INVALID_OPTION_TYPE" };

  const fromDate = String(input.fromDate ?? "").trim();
  const toDate = String(input.toDate ?? fromDate).trim();
  const fromMs = calendarDateMs(fromDate);
  const toMs = calendarDateMs(toDate);
  if (fromMs === null || toMs === null) return { ok: false, reason: "INVALID_DATE_RANGE" };
  if (fromMs > toMs) return { ok: false, reason: "INVALID_DATE_RANGE" };
  if ((toMs - fromMs) / 86_400_000 + 1 > MAX_RANGE_DAYS) return { ok: false, reason: "DATE_RANGE_EXCEEDS_45_DAYS" };
  const expiryMs = calendarDateMs(expiry)!;
  if (fromMs > expiryMs) return { ok: false, reason: "JOURNEY_START_AFTER_EXPIRY" };

  const fromTime = String(input.fromTime ?? "09:15").trim();
  const toTime = String(input.toTime ?? "15:30").trim();
  if (!TIME_RE.test(fromTime) || !TIME_RE.test(toTime)) return { ok: false, reason: "INVALID_TIME_RANGE" };
  if (timeMinutes(fromTime) > timeMinutes(toTime)) return { ok: false, reason: "INVALID_TIME_RANGE" };
  if (timeMinutes(fromTime) < timeMinutes("09:15") || timeMinutes(toTime) > timeMinutes("15:30")) {
    return { ok: false, reason: "OUTSIDE_MARKET_SESSION" };
  }

  return {
    ok: true,
    value: {
      symbol: symbol as H1ReplaySymbol,
      expiry,
      strike,
      optionType: optionType as H1OptionType,
      fromDate,
      toDate,
      fromTime,
      toTime,
    },
  };
}

function minuteIso(value: unknown): string | null {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function buildH1FixedContractJourneyCoverage(
  markerRows: Array<{ minute_bucket: unknown }>,
  contractRows: Array<{ minute_bucket: unknown; truth_verdict?: unknown }>,
): H1FixedContractJourneyCoverage {
  const markers = new Set(markerRows.map((row) => minuteIso(row.minute_bucket)).filter((x): x is string => x !== null));
  const contracts = new Set(contractRows.map((row) => minuteIso(row.minute_bucket)).filter((x): x is string => x !== null));
  const covered = [...markers].filter((bucket) => contracts.has(bucket));
  const missingContractBuckets = [...markers].filter((bucket) => !contracts.has(bucket)).sort();
  const unmarkedContractBuckets = [...contracts].filter((bucket) => !markers.has(bucket)).sort();
  const coveragePct = markers.size ? Number(((covered.length / markers.size) * 100).toFixed(2)) : 0;
  return {
    semantics: "EXACT_CONTRACT_PRESENCE_ACROSS_EXISTING_H1_TRUTH_MARKERS",
    markerBuckets: markers.size,
    contractBuckets: contracts.size,
    coveredMarkerBuckets: covered.length,
    missingContractBuckets,
    unmarkedContractBuckets,
    coveragePct,
    complete: markers.size > 0 && missingContractBuckets.length === 0,
  };
}

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const result = await dbQuerySafe<T>(sql, params);
  if (!result) throw new Error("H1_FIXED_CONTRACT_JOURNEY_DB_QUERY_FAILED");
  return result.rows;
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
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date)
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time >= $4::time)
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::time <= $5::time)
    ORDER BY payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC
  )`;
}

export async function runH1FixedContractJourneyHttp(
  request: H1FixedContractJourneyRequest,
): Promise<H1FixedContractJourneyResult> {
  if (!dbIsConfigured()) {
    return {
      ok: false,
      available: false,
      mode: "READ_ONLY_FIXED_CONTRACT_JOURNEY_V1",
      productionImpact: "NONE",
      request,
      reason: "DATABASE_URL_NOT_CONFIGURED",
      safety: SAFETY,
    };
  }

  const params = [
    request.symbol,
    request.fromDate,
    request.toDate,
    request.fromTime,
    request.toTime,
    request.expiry,
    request.strike,
    request.optionType,
  ];
  const cte = markerCte();

  try {
    const [markerRows, contractRows] = await Promise.all([
      rows<{ minute_bucket: unknown; truth_verdict: unknown }>(
        `${cte} SELECT minute_bucket, truth_verdict FROM markers ORDER BY minute_bucket ASC`,
        params.slice(0, 5),
      ),
      rows<Record<string, unknown>>(`${cte}
        SELECT
          o.symbol, o.minute_bucket, m.truth_verdict,
          o.snapshot_id, o.expiry, o.expiry_bucket, o.dte,
          o.strike, o.option_type, o.atm_offset, o.is_candidate, o.is_wall,
          o.ltp, o.bid, o.ask, o.spread, o.volume, o.oi, o.oi_change,
          o.derived_oi_change, o.derived_oi_change_source, o.derived_oi_change_gap_seconds,
          o.iv, o.delta, o.gamma, o.vega, o.theta, o.intrinsic, o.extrinsic,
          o.day_high, o.day_low, o.pdh, o.pdl,
          o.quote_timestamp, o.quote_age_seconds,
          o.liquidity_status, o.validation_status, o.calculation_version
        FROM option_snapshot_1m o
        LEFT JOIN markers m ON m.symbol = o.symbol AND m.minute_bucket = o.minute_bucket
        WHERE o.symbol = $1
          AND ((o.minute_bucket AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date)
          AND ((o.minute_bucket AT TIME ZONE 'Asia/Kolkata')::time >= $4::time)
          AND ((o.minute_bucket AT TIME ZONE 'Asia/Kolkata')::time <= $5::time)
          AND o.expiry = $6::date
          AND o.strike = $7::integer
          AND o.option_type = $8::text
        ORDER BY o.minute_bucket ASC`, params),
    ]);

    const coverage = buildH1FixedContractJourneyCoverage(markerRows, contractRows);
    let reason: string | undefined;
    if (markerRows.length === 0) reason = "H1_TRUTH_MARKERS_NOT_RECORDED";
    else if (contractRows.length === 0) reason = "EXACT_CONTRACT_HISTORY_NOT_RECORDED";
    else if (coverage.coveredMarkerBuckets === 0) reason = "EXACT_CONTRACT_TRUTH_ALIGNMENT_NOT_FOUND";

    return {
      ok: true,
      available: coverage.coveredMarkerBuckets > 0,
      mode: "READ_ONLY_FIXED_CONTRACT_JOURNEY_V1",
      productionImpact: "NONE",
      request,
      coverage,
      rows: contractRows,
      ...(reason ? { reason } : {}),
      safety: SAFETY,
    };
  } catch (error) {
    return {
      ok: false,
      available: false,
      mode: "READ_ONLY_FIXED_CONTRACT_JOURNEY_V1",
      productionImpact: "NONE",
      request,
      reason: error instanceof Error ? error.message : "H1_FIXED_CONTRACT_JOURNEY_FAILED",
      safety: SAFETY,
    };
  }
}
