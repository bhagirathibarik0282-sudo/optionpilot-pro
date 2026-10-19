import { dbIsConfigured, dbQuerySafe } from "./db.js";

/** On-demand fixed-contract historical study. No broker traffic, writes or trading authority. */
type Row = Record<string, unknown>;
type Symbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
export type Point = { minute: string; spot: number; ce: number; pe: number; gap: number };
const safety = { readOnly: true, writesPerformed: false, brokerRequests: false,
  affectsSelector: false, affectsVerdict: false, affectsTelegram: false,
  affectsExecution: false, createsOrders: false } as const;
const number = (x: unknown): number | null =>
  x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x);
const positive = (x: unknown): number | null => {
  const n = number(x); return n != null && n > 0 ? n : null;
};
const dir = (n: number) => n > 0 ? 1 : n < 0 ? -1 : 0;
const round = (n: number) => Number(n.toFixed(2));
const ms = (x: unknown) => new Date(String(x ?? "")).getTime();
const ist = (date: string, time: string) => new Date(date + "T" + time + ":00+05:30").toISOString();
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

export function parseSpreadTheory(q: { symbol?: string; dates?: string }) {
  const symbol = String(q.symbol ?? "NIFTY").toUpperCase();
  const dates = String(q.dates ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(symbol)) return { ok: false as const, reason: "INVALID_SYMBOL" };
  if (dates.length < 1 || dates.length > 6 || dates.some(d => !isDate(d)) ||
      new Set(dates).size !== dates.length) return { ok: false as const, reason: "REQUIRE_1_TO_6_UNIQUE_DATES" };
  return { ok: true as const, symbol: symbol as Symbol, dates };
}
function goodQuote(r: Row, side: "ce" | "pe", t: number) {
  const qt = ms(r[side + "_quote_timestamp"]), age = number(r[side + "_quote_age_seconds"]);
  return positive(r[side + "_ltp"]) != null && r[side + "_validation_status"] === "RESEARCH_ELIGIBLE" &&
    Number.isFinite(qt) && qt >= t && qt < t + 60000 &&
    age != null && age >= 0 && age <= 30;
}
export function qualifySpreadRows(rows: Row[]) {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const t = ms(row.minute_bucket);
    if (!Number.isFinite(t)) continue;
    const a = groups.get(t) ?? []; a.push(row); groups.set(t, a);
  }
  const points: Point[] = []; let excludedBuckets = 0;
  for (const [t, group] of [...groups].sort(([a], [b]) => a - b)) {
    if (group.length !== 1) { excludedBuckets++; continue; }
    const r = group[0], spot = positive(r.spot_ltp);
    if (spot == null || r.truth_verdict !== "TRUE" ||
        !r.market_snapshot_id || r.market_snapshot_id !== r.ce_snapshot_id ||
        r.market_snapshot_id !== r.pe_snapshot_id ||
        !goodQuote(r, "ce", t) || !goodQuote(r, "pe", t)) { excludedBuckets++; continue; }
    const ce = positive(r.ce_ltp)!, pe = positive(r.pe_ltp)!;
    points.push({ minute: new Date(t).toISOString(), spot, ce, pe, gap: round(ce - pe) });
  }
  return { points, excludedBuckets, observedBuckets: groups.size };
}

export function evaluateSpreadTheory(points: Point[], cadence: 1 | 3) {
  const by = new Map(points.map(x => [Date.parse(x.minute), x]));
  const step = cadence * 60000;
  let paired = 0, contemporaneousMatches = 0;
  let lead15Compared = 0, spreadLeadMatches = 0, spotLeadMatches = 0;
  let crossoverCount = 0, confirmed3 = 0, reversed3 = 0, untested3 = 0;
  const events: Array<{ timeIst: string; toward: string; heldNext3: boolean | null }> = [];
  for (const p of points) {
    const t = Date.parse(p.minute), prev = by.get(t - step);
    if (!prev) continue;
    const spreadMove = dir(p.gap - prev.gap), spotMove = dir(p.spot - prev.spot);
    if (spreadMove && spotMove) {
      paired++;
      if (spreadMove === spotMove) contemporaneousMatches++;
      const future = by.get(t + 15 * 60000);
      if (future && dir(future.spot - p.spot)) {
        lead15Compared++;
        const futureMove = dir(future.spot - p.spot);
        if (spreadMove === futureMove) spreadLeadMatches++;
        if (spotMove === futureMove) spotLeadMatches++;
      }
    }
    if (!dir(prev.gap) || !dir(p.gap) || dir(prev.gap) === dir(p.gap)) continue;
    crossoverCount++;
    const next = [1, 2, 3].map(i => by.get(t + step * i));
    const held = next.every(Boolean) ? next.every(x => dir(x!.gap) === dir(p.gap)) : null;
    if (held == null) untested3++;
    else if (held) confirmed3++;
    else reversed3++;
    events.push({ timeIst: new Date(t + 19800000).toISOString().slice(11, 16),
      toward: p.gap > 0 ? "CE_ABOVE" : "PE_ABOVE", heldNext3: held });
  }
  return {
    cadenceMinutes: cadence, eligibleMinuteBuckets: points.length,
    contemporaneous: { compared: paired, sameDirection: contemporaneousMatches },
    forward15m: { compared: lead15Compared, spreadDirectionMatched: spreadLeadMatches,
      spotMomentumBaselineMatched: spotLeadMatches },
    crossovers: { total: crossoverCount, confirmedNext3Buckets: confirmed3,
      reversedWithin3Buckets: reversed3, untested: untested3 },
    events: events.slice(0, 30), eventLimitReached: events.length > 30,
  };
}
async function read(sql: string, params: unknown[]): Promise<Row[]> {
  const result = await dbQuerySafe<Row>(sql, params);
  if (!result) throw Error("HISTORICAL_READ_UNAVAILABLE");
  return result.rows;
}

const selectPairSql = [
  "SELECT ce.expiry::text AS expiry, ce.strike, ce.minute_bucket AS selected_at",
  "FROM option_snapshot_1m ce JOIN option_snapshot_1m pe",
  "ON pe.symbol=ce.symbol AND pe.minute_bucket=ce.minute_bucket",
  "AND pe.expiry=ce.expiry AND pe.strike=ce.strike AND pe.option_type='PE'",
  "AND pe.snapshot_id=ce.snapshot_id",
  "WHERE ce.symbol=$1 AND ce.minute_bucket BETWEEN $2::timestamptz AND $3::timestamptz",
  "AND ce.option_type='CE' AND ce.atm_offset=0 AND pe.atm_offset=0",
  "AND ce.expiry >= $4::date",
  "ORDER BY ce.minute_bucket ASC, ce.expiry ASC LIMIT 1",
].join(" ");

const recordedSql = [
  "WITH markers AS (SELECT DISTINCT ON (date_trunc('minute', (payload->>'minuteBucket')::timestamptz))",
  "date_trunc('minute', (payload->>'minuteBucket')::timestamptz) AS bucket,",
  "payload->>'truthVerdict' AS truth_verdict FROM app_state_log",
  "WHERE kind='H1_TRUTH_MARKER' AND payload->>'symbol'=$1",
  "AND (payload->>'minuteBucket')::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz",
  "ORDER BY date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC)",
  "SELECT m.minute_bucket, m.spot_ltp, m.snapshot_id AS market_snapshot_id, markers.truth_verdict,",
  "ce.ltp AS ce_ltp, ce.snapshot_id AS ce_snapshot_id, ce.validation_status AS ce_validation_status,",
  "ce.quote_timestamp AS ce_quote_timestamp, ce.quote_age_seconds AS ce_quote_age_seconds,",
  "pe.ltp AS pe_ltp, pe.snapshot_id AS pe_snapshot_id, pe.validation_status AS pe_validation_status,",
  "pe.quote_timestamp AS pe_quote_timestamp, pe.quote_age_seconds AS pe_quote_age_seconds",
  "FROM market_snapshot_1m m LEFT JOIN markers ON markers.bucket=m.minute_bucket",
  "LEFT JOIN option_snapshot_1m ce ON ce.symbol=m.symbol AND ce.minute_bucket=m.minute_bucket",
  "AND ce.expiry=$4::date AND ce.strike=$5::integer AND ce.option_type='CE'",
  "LEFT JOIN option_snapshot_1m pe ON pe.symbol=m.symbol AND pe.minute_bucket=m.minute_bucket",
  "AND pe.expiry=$4::date AND pe.strike=$5::integer AND pe.option_type='PE'",
  "WHERE m.symbol=$1 AND m.minute_bucket BETWEEN $2::timestamptz AND $3::timestamptz",
  "ORDER BY m.minute_bucket ASC",
].join(" ");

async function runDay(symbol: Symbol, date: string) {
  const scope = [symbol, ist(date, "09:15"), ist(date, "15:30")];
  const selection = await read(selectPairSql, [...scope, date]);
  if (!selection.length) return { date, status: "NO_RECORDED_ATM_PAIR" };
  const chosen = selection[0], expiry = String(chosen.expiry).slice(0, 10), strike = Number(chosen.strike);
  const raw = await read(recordedSql, [...scope, expiry, strike]);
  const eligible = qualifySpreadRows(raw);
  const study = evaluateSpreadTheory(eligible.points, date >= "2026-10-19" ? 1 : 3);
  return { date, status: eligible.points.length ? "OBSERVED" : "NO_ELIGIBLE_PAIR_SAMPLES",
    selected: { expiry, strike, sameStrike: true, fixedAllDay: true,
      selectedAt: new Date(String(chosen.selected_at)).toISOString() },
    observedMinuteBuckets: eligible.observedBuckets, excludedMinuteBuckets: eligible.excludedBuckets,
    ...study };
}

export async function runSpreadTheoryBacktest(q: { symbol?: string; dates?: string }) {
  const parsed = parseSpreadTheory(q);
  if (!parsed.ok) return { status: 400 as const, json: { ok: false, reason: parsed.reason, safety } };
  if (!dbIsConfigured()) return { status: 503 as const,
    json: { ok: false, reason: "DATABASE_URL_NOT_CONFIGURED", safety } };
  // At most six days, sequentially, and never fetched by an automatic job.
  const days = [];
  for (const date of parsed.dates) {
    try { days.push(await runDay(parsed.symbol, date)); }
    catch { days.push({ date, status: "HISTORICAL_READ_UNAVAILABLE" }); }
  }
  return { status: 200 as const, json: {
    ok: true, mode: "READ_ONLY_SPREAD_THEORY_BACKTEST_V1",
    symbol: parsed.symbol, dates: parsed.dates, days,
    formula: "SAME_STRIKE_CE_MINUS_PE", outcome: "FUTURE_15M_SPOT_DIRECTION",
    baseline: "PRIOR_SPOT_DIRECTION_SAME_WINDOWS",
    cadence: "EXACT_3M_BEFORE_2026_10_19_ELSE_1M",
    policy: "TRUE_MARKER_BOTH_RESEARCH_ELIGIBLE_MATCHING_MARKET_SNAPSHOT_AGE_LE_30S",
    limitations: ["RESEARCH_ONLY_NOT_WIN_RATE", "NO_CROSS_STRIKE_PARITY_CLAIM",
      "RETROSPECTIVE_CROSSOVER_CONFIRMATION", "NO_INTERPOLATION", "NO_SLIPPAGE_OR_EXECUTION"],
    safety,
  } };
}
