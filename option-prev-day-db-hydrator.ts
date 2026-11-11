import { dbIsConfigured, dbQuerySafe } from "./db.js";

export type OptionSide = "CE" | "PE";

export interface OptionIdentity {
  instrumentToken: number;
  strike: number;
  optionType: OptionSide;
}

export interface OptionPrevDayDbRow {
  strike: number | string;
  option_type: string;
  pdh: number | string | null;
  pdl: number | string | null;
}

export interface OptionPrevDayLevel {
  pdh: number;
  pdl: number;
}

export function mapPreviousDayDbRowsToTokens(
  instruments: OptionIdentity[],
  rows: OptionPrevDayDbRow[],
): Map<number, OptionPrevDayLevel> {
  const byIdentity = new Map<string, number>();
  for (const inst of instruments) {
    if (!Number.isFinite(inst.instrumentToken) || !Number.isFinite(inst.strike)) continue;
    if (inst.optionType !== "CE" && inst.optionType !== "PE") continue;
    byIdentity.set(`${inst.strike}|${inst.optionType}`, inst.instrumentToken);
  }

  const out = new Map<number, OptionPrevDayLevel>();
  for (const row of rows) {
    const strike = Number(row.strike);
    const side = String(row.option_type).toUpperCase();
    const pdh = Number(row.pdh);
    const pdl = Number(row.pdl);
    if (!Number.isFinite(strike) || (side !== "CE" && side !== "PE")) continue;
    if (!Number.isFinite(pdh) || !Number.isFinite(pdl) || pdh <= 0 || pdl <= 0 || pdh < pdl) continue;
    const token = byIdentity.get(`${strike}|${side}`);
    if (token == null) continue;
    out.set(token, { pdh, pdl });
  }
  return out;
}

/**
 * Read-only cold-cache accelerator.
 *
 * Safety:
 * - caller supplies the previous trading date already confirmed from Kite.
 * - only RESEARCH_ELIGIBLE recorder rows for that exact date/expiry are used.
 * - returns null when DB is unavailable/query fails so caller can keep the
 *   existing Kite historical fallback unchanged.
 */
export async function loadPreviousDayOptionLevelsFromDb(args: {
  symbol: string;
  previousTradingDate: string;
  expiryDate: string;
  instruments: OptionIdentity[];
}): Promise<Map<number, OptionPrevDayLevel> | null> {
  if (!dbIsConfigured()) return null;

  const result = await dbQuerySafe<OptionPrevDayDbRow>(
    `
      SELECT
        strike,
        option_type,
        MAX(day_high) FILTER (WHERE day_high > 0) AS pdh,
        MIN(day_low) FILTER (WHERE day_low > 0) AS pdl
      FROM option_snapshot_1m
      WHERE symbol = $1
        AND (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date = $2::date
        AND expiry = $3::date
        AND validation_status = 'RESEARCH_ELIGIBLE'
        AND day_high IS NOT NULL
        AND day_low IS NOT NULL
      GROUP BY strike, option_type
    `,
    [args.symbol, args.previousTradingDate, args.expiryDate],
  );

  if (!result) return null;
  return mapPreviousDayDbRowsToTokens(args.instruments, result.rows);
}

/** Closing recorder observations for the app. Intraday-only rows cannot supply a final range. */
export async function loadClosingOptionLevelsFromDb(args: {
  symbol: string;
  previousTradingDate: string;
  expiryDate: string;
  instruments: OptionIdentity[];
}): Promise<Map<number, OptionPrevDayLevel> | null> {
  if (!dbIsConfigured()) return null;
  const result = await dbQuerySafe<OptionPrevDayDbRow>(
    `
      SELECT strike, option_type, day_high AS pdh, day_low AS pdl
      FROM option_snapshot_1m
      WHERE symbol = $1
        AND expiry = $3::date
        AND minute_bucket >= (($2::date + TIME '15:30') AT TIME ZONE 'Asia/Kolkata')
        AND minute_bucket < (($2::date + TIME '15:31') AT TIME ZONE 'Asia/Kolkata')
        AND quote_timestamp >= (($2::date + TIME '15:29:55') AT TIME ZONE 'Asia/Kolkata')
        AND quote_timestamp < (($2::date + TIME '15:31') AT TIME ZONE 'Asia/Kolkata')
        AND validation_status = 'RESEARCH_ELIGIBLE'
        AND day_high >= ltp AND ltp >= day_low AND day_low > 0
    `,
    [args.symbol, args.previousTradingDate, args.expiryDate],
  );
  return result ? mapPreviousDayDbRowsToTokens(args.instruments, result.rows) : null;
}
