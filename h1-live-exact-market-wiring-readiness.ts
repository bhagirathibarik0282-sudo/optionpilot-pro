import type { H1LiveContractSelectionResult, H1LiveSelectedContractPeerPair } from "./h1-live-contract-selection.js";
import type { H1LiveSelectionExactRegistryPreflightResult } from "./h1-live-selection-exact-registry-preflight.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1LiveExactMarketWiringReadinessResult {
  version: "H1_LIVE_EXACT_MARKET_WIRING_READINESS_V1";
  ready: boolean;
  registry: KiteImmediateTokenRegistry | null;
  instrumentTokens: number[];
  mode: "full";
  selectedSymbolCount: number;
  selectedOptionTokenCount: number;
  blockers: string[];
  source: "PR241_EXACT_REGISTRY_FILTERED_FOR_LIVE_WS";
  productionImpact: "NONE";
  startsSocket: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  activatesShadow: false;
  infersTokens: false;
  failClosed: true;
}

function result(
  ready: boolean,
  registry: KiteImmediateTokenRegistry | null,
  selectedSymbolCount: number,
  selectedOptionTokenCount: number,
  blockers: string[],
): H1LiveExactMarketWiringReadinessResult {
  return {
    version: "H1_LIVE_EXACT_MARKET_WIRING_READINESS_V1",
    ready,
    registry: ready ? registry : null,
    instrumentTokens: ready && registry ? registry.tokens() : [],
    mode: "full",
    selectedSymbolCount: ready ? selectedSymbolCount : 0,
    selectedOptionTokenCount: ready ? selectedOptionTokenCount : 0,
    blockers: [...new Set(blockers)],
    source: "PR241_EXACT_REGISTRY_FILTERED_FOR_LIVE_WS",
    productionImpact: "NONE",
    startsSocket: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    activatesShadow: false,
    infersTokens: false,
    failClosed: true,
  };
}

function pairTokens(pair: H1LiveSelectedContractPeerPair): number[] {
  return [pair.ceInstrumentToken, pair.peInstrumentToken];
}

function expectedIdentity(
  symbol: KiteImmediateTokenEntry["symbol"],
  pair: H1LiveSelectedContractPeerPair,
  token: number,
): { expiry: string; strike: number; optionSide: "CE" | "PE" } {
  return {
    expiry: pair.expiry,
    strike: pair.strike,
    optionSide: token === pair.ceInstrumentToken ? "CE" : "PE",
  };
}

/**
 * Produces the minimal exact registry that can be handed to the existing Kite
 * WebSocket transport/supervisor. It does not open a socket. Only one SPOT token
 * per selected symbol plus the exact primary + two peer CE/PE pairs selected by
 * PR240/PR241 are retained; unrelated base-registry tokens are intentionally
 * excluded. No token, strike, expiry or side is inferred.
 */
export function prepareH1LiveExactMarketWiring(
  selection: H1LiveContractSelectionResult,
  preflight: H1LiveSelectionExactRegistryPreflightResult,
): H1LiveExactMarketWiringReadinessResult {
  if (!selection.ready) {
    return result(false, null, 0, 0, ["LIVE_SELECTION_NOT_READY", ...selection.blockers]);
  }
  if (!preflight.ready || !preflight.registry) {
    return result(false, null, 0, 0, ["EXACT_REGISTRY_PREFLIGHT_NOT_READY", ...preflight.blockers]);
  }
  if (selection.rows.length === 0) return result(false, null, 0, 0, ["LIVE_SELECTION_EMPTY"]);

  const source = preflight.registry;
  const exactEntries: KiteImmediateTokenEntry[] = [];
  const seen = new Set<number>();

  for (const row of selection.rows) {
    if (row.peerPairs.length !== 2) {
      return result(false, null, 0, 0, [`EXACTLY_TWO_PEER_PAIRS_REQUIRED:${row.symbol}:${row.peerPairs.length}`]);
    }

    const spots = source.entries().filter((entry) => entry.symbol === row.symbol && entry.role === "SPOT");
    if (spots.length !== 1) {
      return result(false, null, 0, 0, [`EXACT_ONE_SPOT_REQUIRED:${row.symbol}:${spots.length}`]);
    }
    if (!seen.has(spots[0].instrumentToken)) {
      seen.add(spots[0].instrumentToken);
      exactEntries.push(spots[0]);
    }

    const pairs: H1LiveSelectedContractPeerPair[] = [row, ...row.peerPairs];
    for (const pair of pairs) {
      for (const token of pairTokens(pair)) {
        const entry = source.get(token);
        const expected = expectedIdentity(row.symbol, pair, token);
        if (!entry || entry.symbol !== row.symbol || entry.role !== "OPTION" ||
            entry.expiry !== expected.expiry || Number(entry.strike) !== Number(expected.strike) ||
            entry.optionSide !== expected.optionSide) {
          return result(false, null, 0, 0, [`EXACT_SELECTED_OPTION_IDENTITY_MISSING:${row.symbol}:${token}`]);
        }
        if (!seen.has(token)) {
          seen.add(token);
          exactEntries.push(entry);
        }
      }
    }
  }

  try {
    const registry = new KiteImmediateTokenRegistry(exactEntries);
    const optionCount = registry.entries().filter((entry) => entry.role === "OPTION").length;
    const expectedOptionCount = selection.rows.length * 6;
    if (optionCount !== expectedOptionCount) {
      return result(false, null, 0, 0, [`EXACT_OPTION_TOKEN_COUNT_MISMATCH:${optionCount}:${expectedOptionCount}`]);
    }
    return result(true, registry, selection.rows.length, optionCount, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "UNKNOWN_REGISTRY_ERROR";
    return result(false, null, 0, 0, [`LIVE_MARKET_WIRING_REGISTRY_FAILED:${message}`]);
  }
}
