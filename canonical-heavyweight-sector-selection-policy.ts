import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { CanonicalConstituentRequest } from "./canonical-constituent-token-registry.js";
import type {
  CanonicalIndexOperatingMode,
  CanonicalOfficialUniverseValidation,
} from "./canonical-official-index-universe-freeze.js";

export const CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1 = "CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1" as const;

export interface CanonicalHeavyweightSectorPolicyConfig {
  heavyweightCount: Record<CanonicalMarketSymbol, number>;
  sectorMethod: "ALL_OFFICIAL_CONSTITUENTS";
}

export interface CanonicalHeavyweightSectorScopeSummary {
  symbol: CanonicalMarketSymbol;
  operatingMode: CanonicalIndexOperatingMode;
  heavyweightCount: number;
  sectorConstituentCount: number;
  heavyweightWeightCoveragePct: number;
}

export interface CanonicalHeavyweightSectorSelectionResult {
  version: typeof CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1;
  ready: boolean;
  sourceManifestHash: string | null;
  requests: CanonicalConstituentRequest[];
  scopes: CanonicalHeavyweightSectorScopeSummary[];
  blockers: string[];
  heavyweightMethod: "TOP_K_OFFICIAL_WEIGHT_DESC_SYMBOL_ASC";
  sectorMethod: "ALL_OFFICIAL_CONSTITUENTS";
  readOnly: true;
  deterministic: true;
  infersMembership: false;
  activatesRuntime: false;
  affectsDirection: false;
  affectsVerdict: false;
  grantsCandidateAuthority: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const SYMBOLS: CanonicalMarketSymbol[] = ["NIFTY", "SENSEX", "BANKNIFTY"];

function output(
  ready: boolean,
  sourceManifestHash: string | null,
  requests: CanonicalConstituentRequest[],
  scopes: CanonicalHeavyweightSectorScopeSummary[],
  blockers: string[],
): CanonicalHeavyweightSectorSelectionResult {
  return {
    version: CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1,
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    requests: ready ? requests.map((request) => ({ ...request })) : [],
    scopes: ready ? scopes.map((scope) => ({ ...scope })) : [],
    blockers: [...new Set(blockers)],
    heavyweightMethod: "TOP_K_OFFICIAL_WEIGHT_DESC_SYMBOL_ASC",
    sectorMethod: "ALL_OFFICIAL_CONSTITUENTS",
    readOnly: true,
    deterministic: true,
    infersMembership: false,
    activatesRuntime: false,
    affectsDirection: false,
    affectsVerdict: false,
    grantsCandidateAuthority: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

/**
 * Converts only an already-validated official universe into an explicit read-only request list.
 * Heavyweights are the transparent top-K by official index weight, with symbol as deterministic
 * tie-breaker. Sector breadth uses every official constituent so no sector membership is guessed.
 */
export function buildCanonicalHeavyweightSectorSelection(
  validation: CanonicalOfficialUniverseValidation,
  config: CanonicalHeavyweightSectorPolicyConfig,
): CanonicalHeavyweightSectorSelectionResult {
  const blockers: string[] = [];
  if (!validation?.ready || !validation.manifest || !validation.manifestHash) {
    blockers.push("CANONICAL_SELECTION_OFFICIAL_UNIVERSE_NOT_READY");
  }
  if (config?.sectorMethod !== "ALL_OFFICIAL_CONSTITUENTS") {
    blockers.push("CANONICAL_SELECTION_SECTOR_METHOD_INVALID");
  }

  for (const symbol of SYMBOLS) {
    const count = config?.heavyweightCount?.[symbol];
    if (!Number.isInteger(count) || count <= 0) {
      blockers.push(`CANONICAL_SELECTION_HEAVYWEIGHT_COUNT_INVALID:${symbol}`);
    }
  }

  if (blockers.length > 0 || !validation.manifest || !validation.manifestHash) {
    return output(false, null, [], [], blockers);
  }

  const requests: CanonicalConstituentRequest[] = [];
  const scopes: CanonicalHeavyweightSectorScopeSummary[] = [];

  for (const symbol of SYMBOLS) {
    const scopeMatches = validation.manifest.scopes.filter((scope) => scope.symbol === symbol);
    if (scopeMatches.length !== 1) {
      blockers.push(`CANONICAL_SELECTION_SCOPE_NOT_UNIQUE:${symbol}`);
      continue;
    }
    const scope = scopeMatches[0];
    const heavyweightCount = config.heavyweightCount[symbol];
    if (heavyweightCount > scope.entries.length) {
      blockers.push(`CANONICAL_SELECTION_HEAVYWEIGHT_COUNT_EXCEEDS_UNIVERSE:${symbol}`);
      continue;
    }

    const ranked = [...scope.entries].sort((a, b) => {
      const byWeight = b.weightPct - a.weightPct;
      if (byWeight !== 0) return byWeight;
      return a.tradingsymbol.localeCompare(b.tradingsymbol);
    });
    const heavyweights = ranked.slice(0, heavyweightCount);

    for (const entry of heavyweights) {
      requests.push({
        parentSymbol: symbol,
        role: "HEAVYWEIGHT",
        tradingsymbol: entry.tradingsymbol,
        sector: entry.sector,
        weight: entry.weightPct,
      });
    }

    for (const entry of [...scope.entries].sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol))) {
      requests.push({
        parentSymbol: symbol,
        role: "SECTOR_CONSTITUENT",
        tradingsymbol: entry.tradingsymbol,
        sector: entry.sector,
        weight: entry.weightPct,
      });
    }

    scopes.push({
      symbol,
      operatingMode: scope.operatingMode,
      heavyweightCount,
      sectorConstituentCount: scope.entries.length,
      heavyweightWeightCoveragePct: Number(heavyweights.reduce((sum, entry) => sum + entry.weightPct, 0).toFixed(8)),
    });
  }

  if (blockers.length > 0) return output(false, null, [], [], blockers);
  return output(true, validation.manifestHash, requests, scopes, []);
}
