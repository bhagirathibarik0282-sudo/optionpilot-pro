import { createHash } from "node:crypto";
import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";

export const CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1 = "CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1" as const;

export type CanonicalIndexOperatingMode = "BUYER_ELIGIBLE" | "OBSERVATION_ONLY_MONTHLY";

export interface CanonicalOfficialUniverseEntry {
  tradingsymbol: string;
  sector: string;
  weightPct: number;
}

export interface CanonicalOfficialUniverseScope {
  symbol: CanonicalMarketSymbol;
  operatingMode: CanonicalIndexOperatingMode;
  sourceUrl: string;
  sourceAsOfDate: string;
  sourceSha256: string;
  expectedConstituentCount: number;
  entries: CanonicalOfficialUniverseEntry[];
}

export interface CanonicalOfficialUniverseManifest {
  version: typeof CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1;
  manifestId: string;
  generatedAt: string;
  scopes: CanonicalOfficialUniverseScope[];
}

export interface CanonicalOfficialUniverseValidation {
  version: typeof CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1;
  ready: boolean;
  manifestHash: string | null;
  manifest: CanonicalOfficialUniverseManifest | null;
  blockers: string[];
  readOnly: true;
  frozenEvidenceOnly: true;
  activatesRuntime: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const REQUIRED_MODE: Record<CanonicalMarketSymbol, CanonicalIndexOperatingMode> = {
  NIFTY: "BUYER_ELIGIBLE",
  SENSEX: "BUYER_ELIGIBLE",
  BANKNIFTY: "OBSERVATION_ONLY_MONTHLY",
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function validOfficialSource(symbol: CanonicalMarketSymbol, sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (symbol === "NIFTY" || symbol === "BANKNIFTY") {
      return host === "niftyindices.com" || host === "www.niftyindices.com";
    }
    return host === "bseindices.com" || host === "www.bseindices.com" || host === "bseindia.com" || host === "www.bseindia.com";
  } catch {
    return false;
  }
}

function canonicalize(manifest: CanonicalOfficialUniverseManifest): CanonicalOfficialUniverseManifest {
  return {
    version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
    manifestId: manifest.manifestId.trim(),
    generatedAt: new Date(manifest.generatedAt).toISOString(),
    scopes: [...manifest.scopes]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((scope) => ({
        symbol: scope.symbol,
        operatingMode: scope.operatingMode,
        sourceUrl: scope.sourceUrl.trim(),
        sourceAsOfDate: scope.sourceAsOfDate,
        sourceSha256: scope.sourceSha256.toLowerCase(),
        expectedConstituentCount: scope.expectedConstituentCount,
        entries: [...scope.entries]
          .map((entry) => ({
            tradingsymbol: normalized(entry.tradingsymbol),
            sector: normalized(entry.sector),
            weightPct: Number(entry.weightPct),
          }))
          .sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol)),
      })),
  };
}

function output(ready: boolean, manifest: CanonicalOfficialUniverseManifest | null, blockers: string[]): CanonicalOfficialUniverseValidation {
  const manifestHash = ready && manifest
    ? createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")
    : null;
  return {
    version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
    ready,
    manifestHash,
    manifest: ready ? manifest : null,
    blockers: [...new Set(blockers)],
    readOnly: true,
    frozenEvidenceOnly: true,
    activatesRuntime: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

/**
 * Validates a complete, source-hashed official index universe before any selection policy
 * may consume it. This function does not pick heavyweights or sector representatives and
 * cannot activate the runtime.
 */
export function validateCanonicalOfficialUniverseManifest(
  input: CanonicalOfficialUniverseManifest,
  options: { asOfDate: string; maxSourceAgeDays: number; weightTolerancePct?: number },
): CanonicalOfficialUniverseValidation {
  const blockers: string[] = [];
  if (input?.version !== CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1) blockers.push("OFFICIAL_UNIVERSE_VERSION_INVALID");
  if (typeof input?.manifestId !== "string" || !input.manifestId.trim()) blockers.push("OFFICIAL_UNIVERSE_MANIFEST_ID_REQUIRED");
  if (typeof input?.generatedAt !== "string" || !Number.isFinite(Date.parse(input.generatedAt))) blockers.push("OFFICIAL_UNIVERSE_GENERATED_AT_INVALID");
  if (!validDate(options?.asOfDate)) blockers.push("OFFICIAL_UNIVERSE_AS_OF_DATE_INVALID");
  if (!Number.isInteger(options?.maxSourceAgeDays) || options.maxSourceAgeDays < 0) blockers.push("OFFICIAL_UNIVERSE_MAX_SOURCE_AGE_INVALID");
  if (!Array.isArray(input?.scopes)) return output(false, null, [...blockers, "OFFICIAL_UNIVERSE_SCOPES_REQUIRED"]);

  const expectedSymbols: CanonicalMarketSymbol[] = ["NIFTY", "SENSEX", "BANKNIFTY"];
  for (const symbol of expectedSymbols) {
    const matches = input.scopes.filter((scope) => scope?.symbol === symbol);
    if (matches.length !== 1) {
      blockers.push(`OFFICIAL_UNIVERSE_SCOPE_${matches.length === 0 ? "MISSING" : "DUPLICATE"}:${symbol}`);
      continue;
    }
    const scope = matches[0];
    if (scope.operatingMode !== REQUIRED_MODE[symbol]) blockers.push(`OFFICIAL_UNIVERSE_MODE_INVALID:${symbol}`);
    if (!validOfficialSource(symbol, scope.sourceUrl)) blockers.push(`OFFICIAL_UNIVERSE_SOURCE_INVALID:${symbol}`);
    if (!validDate(scope.sourceAsOfDate)) {
      blockers.push(`OFFICIAL_UNIVERSE_SOURCE_DATE_INVALID:${symbol}`);
    } else if (validDate(options.asOfDate) && Number.isInteger(options.maxSourceAgeDays) && options.maxSourceAgeDays >= 0) {
      const ageDays = (Date.parse(`${options.asOfDate}T00:00:00.000Z`) - Date.parse(`${scope.sourceAsOfDate}T00:00:00.000Z`)) / 86_400_000;
      if (ageDays < 0) blockers.push(`OFFICIAL_UNIVERSE_SOURCE_FUTURE_DATED:${symbol}`);
      if (ageDays > options.maxSourceAgeDays) blockers.push(`OFFICIAL_UNIVERSE_SOURCE_STALE:${symbol}`);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(scope.sourceSha256)) blockers.push(`OFFICIAL_UNIVERSE_SOURCE_HASH_INVALID:${symbol}`);
    if (!Number.isInteger(scope.expectedConstituentCount) || scope.expectedConstituentCount <= 0) blockers.push(`OFFICIAL_UNIVERSE_EXPECTED_COUNT_INVALID:${symbol}`);
    if (!Array.isArray(scope.entries) || scope.entries.length === 0) {
      blockers.push(`OFFICIAL_UNIVERSE_ENTRIES_REQUIRED:${symbol}`);
      continue;
    }
    if (scope.entries.length !== scope.expectedConstituentCount) blockers.push(`OFFICIAL_UNIVERSE_COUNT_MISMATCH:${symbol}`);

    const seen = new Set<string>();
    let totalWeight = 0;
    for (const entry of scope.entries) {
      const tradingsymbol = normalized(entry?.tradingsymbol);
      const sector = normalized(entry?.sector);
      if (!tradingsymbol) blockers.push(`OFFICIAL_UNIVERSE_TRADINGSYMBOL_REQUIRED:${symbol}`);
      if (!sector) blockers.push(`OFFICIAL_UNIVERSE_SECTOR_REQUIRED:${symbol}:${tradingsymbol || "UNKNOWN"}`);
      if (seen.has(tradingsymbol)) blockers.push(`OFFICIAL_UNIVERSE_DUPLICATE_CONSTITUENT:${symbol}:${tradingsymbol}`);
      seen.add(tradingsymbol);
      if (typeof entry?.weightPct !== "number" || !Number.isFinite(entry.weightPct) || entry.weightPct <= 0 || entry.weightPct > 100) {
        blockers.push(`OFFICIAL_UNIVERSE_WEIGHT_INVALID:${symbol}:${tradingsymbol || "UNKNOWN"}`);
      } else {
        totalWeight += entry.weightPct;
      }
    }
    const tolerance = typeof options.weightTolerancePct === "number" && Number.isFinite(options.weightTolerancePct)
      ? options.weightTolerancePct
      : 0.5;
    if (tolerance < 0 || Math.abs(totalWeight - 100) > tolerance) blockers.push(`OFFICIAL_UNIVERSE_WEIGHT_TOTAL_INVALID:${symbol}`);
  }

  const unsupported = input.scopes.filter((scope) => !expectedSymbols.includes(scope?.symbol));
  if (unsupported.length > 0) blockers.push("OFFICIAL_UNIVERSE_UNSUPPORTED_SCOPE");
  if (blockers.length > 0) return output(false, null, blockers);

  return output(true, canonicalize(input), []);
}
