import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export interface NormalizedLiveInstrumentRow {
  instrumentToken: number;
  symbol: RecorderSymbol;
  role: "SPOT" | "FUTURE" | "OPTION" | "INDIA_VIX";
  instrumentLabel: string;
  expiry?: string | null;
  strike?: number | null;
  optionSide?: "CE" | "PE" | null;
}

export interface H1CanonicalShadowRegistryBuildResult {
  version: "H1_CANONICAL_SHADOW_REGISTRY_BUILDER_V1";
  ready: boolean;
  entries: KiteImmediateTokenEntry[];
  blockers: string[];
  productionImpact: "NONE";
  failClosed: true;
}

function validSymbol(symbol: unknown): symbol is RecorderSymbol {
  return symbol === "NIFTY" || symbol === "BANKNIFTY" || symbol === "SENSEX";
}

function validExpiry(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function buildH1CanonicalShadowRegistry(
  rows: NormalizedLiveInstrumentRow[],
): H1CanonicalShadowRegistryBuildResult {
  const blockers: string[] = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return result(false, [], ["MISSING_NORMALIZED_LIVE_INSTRUMENT_ROWS"]);
  }

  const byToken = new Map<number, KiteImmediateTokenEntry>();
  for (const row of rows) {
    if (!Number.isInteger(row?.instrumentToken) || row.instrumentToken <= 0) {
      blockers.push("INVALID_INSTRUMENT_TOKEN");
      continue;
    }
    if (byToken.has(row.instrumentToken)) {
      blockers.push("DUPLICATE_INSTRUMENT_TOKEN");
      continue;
    }
    if (!validSymbol(row.symbol)) {
      blockers.push("UNSUPPORTED_SYMBOL");
      continue;
    }
    const label = row.instrumentLabel?.trim();
    if (!label) {
      blockers.push("MISSING_INSTRUMENT_LABEL");
      continue;
    }
    if (row.role !== "SPOT" && row.role !== "FUTURE" && row.role !== "OPTION" && row.role !== "INDIA_VIX") {
      blockers.push("INVALID_INSTRUMENT_ROLE");
      continue;
    }

    if (row.role === "OPTION") {
      if ((row.optionSide !== "CE" && row.optionSide !== "PE") ||
          !validExpiry(row.expiry) ||
          !Number.isFinite(row.strike) || Number(row.strike) <= 0) {
        blockers.push("INVALID_OPTION_IDENTITY");
        continue;
      }
      byToken.set(row.instrumentToken, {
        instrumentToken: row.instrumentToken,
        symbol: row.symbol,
        role: "OPTION",
        instrumentLabel: label,
        expiry: row.expiry,
        strike: Number(row.strike),
        optionSide: row.optionSide,
      });
      continue;
    }

    if (row.optionSide != null || row.strike != null || row.expiry != null) {
      blockers.push("NON_OPTION_IDENTITY_FIELDS_FORBIDDEN");
      continue;
    }

    byToken.set(row.instrumentToken, {
      instrumentToken: row.instrumentToken,
      symbol: row.symbol,
      role: row.role,
      instrumentLabel: label,
      optionSide: null,
    });
  }

  const entries = [...byToken.values()].sort((a, b) => a.instrumentToken - b.instrumentToken);
  const optionCount = entries.filter((x) => x.role === "OPTION").length;
  if (optionCount === 0) blockers.push("NO_CANONICAL_OPTION_ENTRIES");

  return blockers.length === 0
    ? result(true, entries, [])
    : result(false, [], blockers);
}

function result(
  ready: boolean,
  entries: KiteImmediateTokenEntry[],
  blockers: string[],
): H1CanonicalShadowRegistryBuildResult {
  return {
    version: "H1_CANONICAL_SHADOW_REGISTRY_BUILDER_V1",
    ready,
    entries,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    failClosed: true,
  };
}
