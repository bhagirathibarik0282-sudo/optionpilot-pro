import type { H1LiveContractSelectionResult, H1LiveSelectedContractPeerPair } from "./h1-live-contract-selection.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1LiveSelectionExactRegistryPreflightResult {
  version: "H1_LIVE_SELECTION_EXACT_REGISTRY_PREFLIGHT_V1";
  ready: boolean;
  registry: KiteImmediateTokenRegistry | null;
  addedOptionTokens: number;
  selectedPairCount: number;
  blockers: string[];
  source: "PR240_EXACT_SELECTED_TOKENS_ONLY";
  productionImpact: "NONE";
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  activatesShadow: false;
  infersTokens: false;
  failClosed: true;
}

function output(
  ready: boolean,
  registry: KiteImmediateTokenRegistry | null,
  addedOptionTokens: number,
  selectedPairCount: number,
  blockers: string[],
): H1LiveSelectionExactRegistryPreflightResult {
  return {
    version: "H1_LIVE_SELECTION_EXACT_REGISTRY_PREFLIGHT_V1",
    ready,
    registry: ready ? registry : null,
    addedOptionTokens: ready ? addedOptionTokens : 0,
    selectedPairCount: ready ? selectedPairCount : 0,
    blockers: [...new Set(blockers)],
    source: "PR240_EXACT_SELECTED_TOKENS_ONLY",
    productionImpact: "NONE",
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    activatesShadow: false,
    infersTokens: false,
    failClosed: true,
  };
}

function optionEntries(
  symbol: KiteImmediateTokenEntry["symbol"],
  pair: H1LiveSelectedContractPeerPair,
): KiteImmediateTokenEntry[] {
  return [
    {
      instrumentToken: pair.ceInstrumentToken,
      symbol,
      role: "OPTION",
      instrumentLabel: pair.ceTradingsymbol,
      expiry: pair.expiry,
      strike: pair.strike,
      optionSide: "CE",
    },
    {
      instrumentToken: pair.peInstrumentToken,
      symbol,
      role: "OPTION",
      instrumentLabel: pair.peTradingsymbol,
      expiry: pair.expiry,
      strike: pair.strike,
      optionSide: "PE",
    },
  ];
}

function sameIdentity(a: KiteImmediateTokenEntry, b: KiteImmediateTokenEntry): boolean {
  return a.symbol === b.symbol
    && a.role === b.role
    && (a.expiry ?? null) === (b.expiry ?? null)
    && Number(a.strike ?? 0) === Number(b.strike ?? 0)
    && (a.optionSide ?? null) === (b.optionSide ?? null);
}

export function preflightH1LiveSelectionIntoExactRegistry(
  baseRegistry: KiteImmediateTokenRegistry,
  selection: H1LiveContractSelectionResult,
): H1LiveSelectionExactRegistryPreflightResult {
  if (!selection.ready) {
    return output(false, null, 0, 0, ["LIVE_SELECTION_NOT_READY", ...selection.blockers]);
  }
  if (selection.rows.length === 0) {
    return output(false, null, 0, 0, ["LIVE_SELECTION_EMPTY"]);
  }

  const desired: KiteImmediateTokenEntry[] = [];
  for (const row of selection.rows) {
    if (row.peerPairs.length !== 2) {
      return output(false, null, 0, 0, [`EXACTLY_TWO_PEER_PAIRS_REQUIRED:${row.symbol}:${row.peerPairs.length}`]);
    }
    desired.push(...optionEntries(row.symbol, row));
    for (const peer of row.peerPairs) desired.push(...optionEntries(row.symbol, peer));
  }

  const existingByToken = new Map(baseRegistry.entries().map((entry) => [entry.instrumentToken, entry]));
  const extras: KiteImmediateTokenEntry[] = [];
  for (const entry of desired) {
    const existing = existingByToken.get(entry.instrumentToken);
    if (existing) {
      if (!sameIdentity(existing, entry)) {
        return output(false, null, 0, 0, [`TOKEN_IDENTITY_CONFLICT:${entry.instrumentToken}`]);
      }
      continue;
    }
    existingByToken.set(entry.instrumentToken, entry);
    extras.push(entry);
  }

  try {
    const registry = new KiteImmediateTokenRegistry([...baseRegistry.entries(), ...extras]);
    return output(true, registry, extras.length, desired.length / 2, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "UNKNOWN_REGISTRY_ERROR";
    return output(false, null, 0, 0, [`EXACT_REGISTRY_PREFLIGHT_FAILED:${message}`]);
  }
}
