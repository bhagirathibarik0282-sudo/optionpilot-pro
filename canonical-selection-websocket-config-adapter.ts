import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { CanonicalSelectionStartupBridgeResult } from "./canonical-selection-startup-bridge.js";

export interface CanonicalSelectionWebSocketConfigAdapterResult {
  version: "CANONICAL_SELECTION_WEBSOCKET_CONFIG_ADAPTER_V1";
  ready: boolean;
  sourceManifestHash: string | null;
  constituentRegistry: CanonicalConstituentTokenEntry[];
  uniqueInstrumentTokenCount: number;
  membershipCount: number;
  blockers: string[];
  readOnly: true;
  configOnly: true;
  startsSocket: false;
  activatesRuntime: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsCandidateAuthority: false;
  failClosed: true;
}

function output(
  ready: boolean,
  sourceManifestHash: string | null,
  registry: CanonicalConstituentTokenEntry[],
  blockers: string[],
): CanonicalSelectionWebSocketConfigAdapterResult {
  return {
    version: "CANONICAL_SELECTION_WEBSOCKET_CONFIG_ADAPTER_V1",
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    constituentRegistry: ready ? registry.map((entry) => ({ ...entry })) : [],
    uniqueInstrumentTokenCount: ready ? new Set(registry.map((entry) => entry.instrumentToken)).size : 0,
    membershipCount: ready ? registry.length : 0,
    blockers: [...new Set(blockers)],
    readOnly: true,
    configOnly: true,
    startsSocket: false,
    activatesRuntime: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    failClosed: true,
  };
}

/**
 * Converts only a verified selection-startup bridge into the constituentRegistry config fragment
 * already accepted by H1LiveExactReadOnlyWebSocketService. It does not construct or start a socket,
 * read credentials, activate runtime authority, or publish downstream.
 */
export function buildCanonicalSelectionWebSocketConfig(
  bridge: CanonicalSelectionStartupBridgeResult,
): CanonicalSelectionWebSocketConfigAdapterResult {
  if (!bridge?.ready || !bridge.sourceManifestHash || !Array.isArray(bridge.registry) || bridge.registry.length === 0) {
    return output(false, null, [], ["CANONICAL_SELECTION_WEBSOCKET_BRIDGE_NOT_READY"]);
  }

  if (
    bridge.readOnly !== true
    || bridge.shadowOnly !== true
    || bridge.affectsDirection !== false
    || bridge.affectsVerdict !== false
    || bridge.affectsExecution !== false
    || bridge.affectsTelegram !== false
    || bridge.grantsCandidateAuthority !== false
    || bridge.failClosed !== true
  ) {
    return output(false, null, [], ["CANONICAL_SELECTION_WEBSOCKET_AUTHORITY_BOUNDARY_INVALID"]);
  }

  const membershipKeys = new Set<string>();
  const tokenIdentity = new Map<number, string>();
  for (const entry of bridge.registry) {
    const symbol = entry.tradingsymbol?.trim().toUpperCase();
    if (!Number.isInteger(entry.instrumentToken) || entry.instrumentToken <= 0 || !symbol) {
      return output(false, null, [], ["CANONICAL_SELECTION_WEBSOCKET_REGISTRY_ENTRY_INVALID"]);
    }
    const existingSymbol = tokenIdentity.get(entry.instrumentToken);
    if (existingSymbol && existingSymbol !== symbol) {
      return output(false, null, [], [`CANONICAL_SELECTION_WEBSOCKET_TOKEN_IDENTITY_CONFLICT:${entry.instrumentToken}`]);
    }
    tokenIdentity.set(entry.instrumentToken, symbol);
    const key = `${entry.parentSymbol}|${entry.role}|${symbol}|${entry.sector?.trim().toUpperCase() ?? ""}`;
    if (membershipKeys.has(key)) {
      return output(false, null, [], [`CANONICAL_SELECTION_WEBSOCKET_MEMBERSHIP_DUPLICATE:${key}`]);
    }
    membershipKeys.add(key);
  }

  return output(true, bridge.sourceManifestHash, bridge.registry, []);
}
