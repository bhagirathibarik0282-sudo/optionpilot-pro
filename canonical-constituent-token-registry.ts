import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";

export type CanonicalConstituentRole = "HEAVYWEIGHT" | "SECTOR_CONSTITUENT";

export interface CanonicalConstituentRequest {
  parentSymbol: CanonicalMarketSymbol;
  role: CanonicalConstituentRole;
  tradingsymbol: string;
  sector?: string | null;
  weight?: number | null;
}

export interface CanonicalConstituentTokenEntry {
  instrumentToken: number;
  parentSymbol: CanonicalMarketSymbol;
  role: CanonicalConstituentRole;
  tradingsymbol: string;
  sector: string | null;
  weight: number | null;
  source: "KITE_INSTRUMENT_MASTER";
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function validWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

/**
 * Resolve only explicitly requested constituent contracts from the Kite instrument master.
 * This registry never infers heavyweight membership, sector membership, weights or direction.
 * Missing/duplicate identity fails closed so downstream canonical HEAVYWEIGHTS/SECTOR_BREADTH
 * evidence cannot be fabricated from cross-index proxies.
 */
export function buildCanonicalConstituentTokenRegistry(
  rows: KiteInstrumentMasterRow[],
  requests: CanonicalConstituentRequest[],
): CanonicalConstituentTokenEntry[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("KITE_INSTRUMENT_MASTER_EMPTY");
  if (!Array.isArray(requests) || requests.length === 0) throw new Error("CANONICAL_CONSTITUENT_REQUESTS_EMPTY");

  const seenTokens = new Set<number>();
  const seenKeys = new Set<string>();
  const entries: CanonicalConstituentTokenEntry[] = [];

  for (const request of requests) {
    const tradingsymbol = normalize(request.tradingsymbol);
    if (!tradingsymbol) throw new Error("CANONICAL_CONSTITUENT_TRADINGSYMBOL_REQUIRED");
    if (request.role !== "HEAVYWEIGHT" && request.role !== "SECTOR_CONSTITUENT") {
      throw new Error("CANONICAL_CONSTITUENT_ROLE_INVALID");
    }

    const sector = request.role === "SECTOR_CONSTITUENT" ? normalize(request.sector) : null;
    if (request.role === "SECTOR_CONSTITUENT" && !sector) {
      throw new Error(`CANONICAL_SECTOR_REQUIRED:${tradingsymbol}`);
    }
    if (request.role === "HEAVYWEIGHT" && request.sector != null && !normalize(request.sector)) {
      throw new Error(`CANONICAL_SECTOR_INVALID:${tradingsymbol}`);
    }

    const weight = request.weight == null ? null : request.weight;
    if (weight != null && !validWeight(weight)) throw new Error(`CANONICAL_CONSTITUENT_WEIGHT_INVALID:${tradingsymbol}`);

    const matches = rows.filter((row) => normalize(row.tradingsymbol) === tradingsymbol && Number.isInteger(row.instrument_token) && row.instrument_token > 0);
    if (matches.length !== 1) throw new Error(`CANONICAL_CONSTITUENT_NOT_UNIQUE:${tradingsymbol}:${matches.length}`);
    const row = matches[0];

    const key = `${request.parentSymbol}|${request.role}|${tradingsymbol}|${sector ?? ""}`;
    if (seenKeys.has(key)) throw new Error(`CANONICAL_CONSTITUENT_DUPLICATE_REQUEST:${key}`);
    seenKeys.add(key);
    if (seenTokens.has(row.instrument_token)) throw new Error(`CANONICAL_CONSTITUENT_DUPLICATE_TOKEN:${row.instrument_token}`);
    seenTokens.add(row.instrument_token);

    entries.push({
      instrumentToken: row.instrument_token,
      parentSymbol: request.parentSymbol,
      role: request.role,
      tradingsymbol: row.tradingsymbol,
      sector: request.role === "SECTOR_CONSTITUENT" ? sector : (normalize(request.sector) || null),
      weight,
      source: "KITE_INSTRUMENT_MASTER",
    });
  }

  return entries;
}
