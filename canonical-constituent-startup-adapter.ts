import { buildCanonicalConstituentTokenRegistry, type CanonicalConstituentRequest, type CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";

export const CANONICAL_CONSTITUENT_REQUESTS_ENV = "CANONICAL_CONSTITUENT_REQUESTS_JSON" as const;

export interface CanonicalConstituentStartupResult {
  version: "CANONICAL_CONSTITUENT_STARTUP_ADAPTER_V1";
  configured: boolean;
  ready: boolean;
  requestCount: number;
  registry: CanonicalConstituentTokenEntry[];
  blockers: string[];
  source: "OWNER_APPROVED_JSON_PLUS_KITE_INSTRUMENT_MASTER";
  readOnly: true;
  activatesShadowOnly: true;
  infersMembership: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

function output(configured: boolean, ready: boolean, requestCount: number, registry: CanonicalConstituentTokenEntry[], blockers: string[]): CanonicalConstituentStartupResult {
  return {
    version: "CANONICAL_CONSTITUENT_STARTUP_ADAPTER_V1",
    configured,
    ready,
    requestCount,
    registry: ready ? registry.map((entry) => ({ ...entry })) : [],
    blockers: [...new Set(blockers)],
    source: "OWNER_APPROVED_JSON_PLUS_KITE_INSTRUMENT_MASTER",
    readOnly: true,
    activatesShadowOnly: true,
    infersMembership: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

function parseRequests(raw: string): CanonicalConstituentRequest[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("CANONICAL_CONSTITUENT_REQUESTS_JSON_INVALID");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("CANONICAL_CONSTITUENT_REQUESTS_EMPTY");
  }

  return value.map((item, index) => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`CANONICAL_CONSTITUENT_REQUEST_INVALID:${index}`);
    }
    const row = item as Record<string, unknown>;
    if (row.parentSymbol !== "NIFTY" && row.parentSymbol !== "SENSEX" && row.parentSymbol !== "BANKNIFTY") {
      throw new Error(`CANONICAL_CONSTITUENT_PARENT_SYMBOL_INVALID:${index}`);
    }
    if (row.role !== "HEAVYWEIGHT" && row.role !== "SECTOR_CONSTITUENT") {
      throw new Error(`CANONICAL_CONSTITUENT_ROLE_INVALID:${index}`);
    }
    if (typeof row.tradingsymbol !== "string" || !row.tradingsymbol.trim()) {
      throw new Error(`CANONICAL_CONSTITUENT_TRADINGSYMBOL_REQUIRED:${index}`);
    }
    if (row.sector != null && typeof row.sector !== "string") {
      throw new Error(`CANONICAL_CONSTITUENT_SECTOR_INVALID:${index}`);
    }
    if (row.weight != null && (typeof row.weight !== "number" || !Number.isFinite(row.weight))) {
      throw new Error(`CANONICAL_CONSTITUENT_WEIGHT_INVALID:${index}`);
    }
    return {
      parentSymbol: row.parentSymbol,
      role: row.role,
      tradingsymbol: row.tradingsymbol,
      sector: row.sector as string | null | undefined,
      weight: row.weight as number | null | undefined,
    };
  });
}

function coverageBlockers(requests: CanonicalConstituentRequest[]): string[] {
  const blockers: string[] = [];
  const symbols = [...new Set(requests.map((request) => request.parentSymbol))];
  for (const symbol of symbols) {
    if (!requests.some((request) => request.parentSymbol === symbol && request.role === "HEAVYWEIGHT")) {
      blockers.push(`CANONICAL_HEAVYWEIGHTS_REQUIRED:${symbol}`);
    }
    if (!requests.some((request) => request.parentSymbol === symbol && request.role === "SECTOR_CONSTITUENT")) {
      blockers.push(`CANONICAL_SECTOR_BREADTH_REQUIRED:${symbol}`);
    }
  }
  return blockers;
}

/**
 * Resolves only an explicitly owner-approved JSON request list against the exact Kite
 * instrument master. Missing config never guesses a universe and returns fail-closed.
 */
export function prepareCanonicalConstituentStartup(
  rows: KiteInstrumentMasterRow[],
  rawConfig: string | null | undefined,
): CanonicalConstituentStartupResult {
  const raw = rawConfig?.trim() ?? "";
  if (!raw) return output(false, false, 0, [], ["CANONICAL_CONSTITUENT_REQUESTS_NOT_CONFIGURED"]);

  try {
    const requests = parseRequests(raw);
    const blockers = coverageBlockers(requests);
    if (blockers.length > 0) return output(true, false, requests.length, [], blockers);
    const registry = buildCanonicalConstituentTokenRegistry(rows, requests);
    return output(true, true, requests.length, registry, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "CANONICAL_CONSTITUENT_STARTUP_UNKNOWN";
    return output(true, false, 0, [], [message]);
  }
}
