import type { H1ReplayHttpResult } from "./h1-replay-http.js";

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
  lossless: true;
  request: H1ReplayHttpResult["request"];
  counts?: H1ReplayHttpResult["counts"];
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

export function compactH1Replay(result: H1ReplayHttpResult): H1ReplayCompactResult {
  return {
    ok: result.ok,
    mode: "READ_ONLY_H1_3M_REPLAY_COMPACT_V1",
    sourceMode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    format: "compact",
    lossless: true,
    request: result.request,
    ...(result.counts ? { counts: result.counts } : {}),
    ...(result.market ? { market: compactRows(result.market) } : {}),
    ...(result.options ? { options: compactRows(result.options) } : {}),
    ...(result.chain ? { chain: compactRows(result.chain) } : {}),
    ...(result.canonical ? { canonical: compactRows(result.canonical) } : {}),
    ...(result.continuity ? { continuity: result.continuity } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
