import type { H1ReplayHttpResult } from "./h1-replay-http.js";
import { buildH1Dte0TransitionCalibration } from "./h1-dte0-transition-calibration-v1.js";

export interface H1CompactTable {
  columns: string[];
  rows: unknown[][];
}

export interface H1ReplayCompactResult {
  ok: boolean;
  mode: "READ_ONLY_H1_3M_REPLAY_COMPACT_V1";
  sourceMode: "READ_ONLY_H1_3M_REPLAY";
  productionImpact: "NONE";
  format: "compact";
  lossless: boolean;
  canonicalProjection?: "PCR_PROVENANCE_V1";
  request: H1ReplayHttpResult["request"];
  counts?: H1ReplayHttpResult["counts"];
  queryTimingsMs?: H1ReplayHttpResult["queryTimingsMs"];
  dte0Calibration?: ReturnType<typeof buildH1Dte0TransitionCalibration>;
  market?: H1CompactTable;
  options?: H1CompactTable;
  chain?: H1CompactTable;
  canonical?: H1CompactTable;
  continuity?: H1ReplayHttpResult["continuity"];
  reason?: string;
}

export function compactRows(rows: Record<string, unknown>[]): H1CompactTable {
  if (!rows.length) return { columns: [], rows: [] };
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return {
    columns,
    rows: rows.map((row) => columns.map((key) => Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null)),
  };
}

export function expandRows(table: H1CompactTable): Record<string, unknown>[] {
  return table.rows.map((values) => Object.fromEntries(table.columns.map((key, i) => [key, values[i]])));
}

/** Dashboard only: retain every identity/provenance field used by Full PCR repair.
 * Keep duplicates and malformed structures intact so ambiguity still fails closed.
 * The default compact API remains lossless for research consumers.
 */
export function projectCanonicalPcrRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const market = row.market as any;
    if (!market || typeof market !== "object" || Array.isArray(market)) return { ...row };
    return { ...row, market: {
      symbol: market.symbol,
      gapScore: { fullChainPcr: market.gapScore?.fullChainPcr },
      expiries: Array.isArray(market.expiries)
        ? market.expiries.map((expiry: any) => expiry && typeof expiry === "object"
          ? { expiry: expiry.expiry, expiryDate: expiry.expiryDate,
              ...Object.fromEntries(['ceStrikes','peStrikes'].filter(side=>Array.isArray(expiry[side])).map(side=>[side,expiry[side].map((q:any)=>q&&typeof q==='object'?{strike:q.strike,optionType:q.optionType,expiryDate:q.expiryDate,lastPrice:q.lastPrice,quoteTimestamp:q.quoteTimestamp,pdc:q.pdc}:q)])) } : expiry)
        : market.expiries,
    } };
  });
}

export function compactH1Replay(result: H1ReplayHttpResult, canonicalPcrOnly = false): H1ReplayCompactResult {
  const dte0Calibration = result.ok && result.request
    ? buildH1Dte0TransitionCalibration(result.request, result)
    : undefined;
  return {
    ok: result.ok,
    mode: "READ_ONLY_H1_3M_REPLAY_COMPACT_V1",
    sourceMode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    format: "compact",
    lossless: !canonicalPcrOnly,
    ...(canonicalPcrOnly ? { canonicalProjection: "PCR_PROVENANCE_V1" as const } : {}),
    request: result.request,
    ...(result.counts ? { counts: result.counts } : {}),
    ...(result.queryTimingsMs ? { queryTimingsMs: result.queryTimingsMs } : {}),
    ...(dte0Calibration ? { dte0Calibration } : {}),
    ...(result.market ? { market: compactRows(result.market) } : {}),
    ...(result.options ? { options: compactRows(result.options) } : {}),
    ...(result.chain ? { chain: compactRows(result.chain) } : {}),
    ...(result.canonical ? { canonical: compactRows(canonicalPcrOnly ? projectCanonicalPcrRows(result.canonical) : result.canonical) } : {}),
    ...(result.continuity ? { continuity: result.continuity } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
