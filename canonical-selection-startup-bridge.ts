import { buildCanonicalConstituentTokenRegistry, type CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";
import type { CanonicalHeavyweightSectorSelectionResult } from "./canonical-heavyweight-sector-selection-policy.js";
import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";

export interface CanonicalSelectionStartupBridgeResult {
  version: "CANONICAL_SELECTION_STARTUP_BRIDGE_V1";
  ready: boolean;
  sourceManifestHash: string | null;
  requestCount: number;
  registry: CanonicalConstituentTokenEntry[];
  blockers: string[];
  source: "VERIFIED_SELECTION_PLUS_KITE_INSTRUMENT_MASTER";
  readOnly: true;
  shadowOnly: true;
  bypassesOwnerJson: true;
  infersMembership: false;
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
  requestCount: number,
  registry: CanonicalConstituentTokenEntry[],
  blockers: string[],
): CanonicalSelectionStartupBridgeResult {
  return {
    version: "CANONICAL_SELECTION_STARTUP_BRIDGE_V1",
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    requestCount,
    registry: ready ? registry.map((entry) => ({ ...entry })) : [],
    blockers: [...new Set(blockers)],
    source: "VERIFIED_SELECTION_PLUS_KITE_INSTRUMENT_MASTER",
    readOnly: true,
    shadowOnly: true,
    bypassesOwnerJson: true,
    infersMembership: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    failClosed: true,
  };
}

/**
 * Bridges only an already-verified deterministic selection result into the exact Kite token
 * registry. This removes manual JSON drift while preserving the same fail-closed identity
 * resolution. It does not start sockets, activate runtime authority, or publish downstream.
 */
export function prepareCanonicalSelectionStartupBridge(
  rows: KiteInstrumentMasterRow[],
  selection: CanonicalHeavyweightSectorSelectionResult,
): CanonicalSelectionStartupBridgeResult {
  if (!selection?.ready || !selection.sourceManifestHash || !Array.isArray(selection.requests) || selection.requests.length === 0) {
    return output(false, null, Array.isArray(selection?.requests) ? selection.requests.length : 0, [], ["CANONICAL_SELECTION_STARTUP_SELECTION_NOT_READY"]);
  }

  if (
    selection.activatesRuntime !== false
    || selection.affectsDirection !== false
    || selection.affectsVerdict !== false
    || selection.affectsExecution !== false
    || selection.affectsTelegram !== false
    || selection.grantsCandidateAuthority !== false
  ) {
    return output(false, null, selection.requests.length, [], ["CANONICAL_SELECTION_STARTUP_AUTHORITY_BOUNDARY_INVALID"]);
  }

  try {
    const registry = buildCanonicalConstituentTokenRegistry(rows, selection.requests);
    if (registry.length !== selection.requests.length) {
      return output(false, null, selection.requests.length, [], ["CANONICAL_SELECTION_STARTUP_REGISTRY_COUNT_MISMATCH"]);
    }
    return output(true, selection.sourceManifestHash, selection.requests.length, registry, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "CANONICAL_SELECTION_STARTUP_UNKNOWN";
    return output(false, null, selection.requests.length, [], [message]);
  }
}
