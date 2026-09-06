import { buildCanonicalShadowSnapshot, type CanonicalShadowSnapshotAssemblerInput } from "./canonical-shadow-snapshot-assembler.js";
import type { CanonicalReadOnlyShadowActivationResult } from "./canonical-readonly-shadow-activation-boundary.js";
import type { CanonicalReadOnlyShadowCompositionResult } from "./canonical-readonly-shadow-composition.js";
import type { CanonicalSelectionWebSocketConfigAdapterResult } from "./canonical-selection-websocket-config-adapter.js";

export interface CanonicalLiveShadowSnapshotSourceInput extends Omit<CanonicalShadowSnapshotAssemblerInput, "constituentRegistry" | "constituentTicks"> {
  activation: CanonicalReadOnlyShadowActivationResult;
  composition: CanonicalReadOnlyShadowCompositionResult;
  selectionConfig: CanonicalSelectionWebSocketConfigAdapterResult;
}

export interface CanonicalLiveShadowSnapshotSourceResult {
  version: "CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1";
  ready: boolean;
  sourceManifestHash: string | null;
  snapshot: ReturnType<typeof buildCanonicalShadowSnapshot> | null;
  snapshotReadyForStrictFiltering: boolean;
  constituentTickCount: number;
  blockers: string[];
  readOnly: true;
  shadowOnly: true;
  readsLiveConstituentTicks: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsCandidateAuthority: false;
  wiredIntoServer: false;
  failClosed: true;
}

function output(
  ready: boolean,
  sourceManifestHash: string | null,
  snapshot: ReturnType<typeof buildCanonicalShadowSnapshot> | null,
  constituentTickCount: number,
  blockers: string[],
): CanonicalLiveShadowSnapshotSourceResult {
  return {
    version: "CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1",
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    snapshot: ready ? snapshot : null,
    snapshotReadyForStrictFiltering: ready ? Boolean(snapshot?.readyForStrictFiltering) : false,
    constituentTickCount: ready ? constituentTickCount : 0,
    blockers: [...new Set(blockers)],
    readOnly: true,
    shadowOnly: true,
    readsLiveConstituentTicks: true,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    wiredIntoServer: false,
    failClosed: true,
  };
}

/**
 * Reads constituent ticks only from an explicitly activated, already-verified read-only shadow
 * service and injects them into the existing canonical shadow snapshot assembler. The resulting
 * snapshot keeps its own strict readiness/new-entry gate; this boundary never promotes a blocked
 * snapshot, forwards it downstream, or grants trading authority.
 */
export function buildCanonicalLiveShadowSnapshotSource(
  input: CanonicalLiveShadowSnapshotSourceInput,
): CanonicalLiveShadowSnapshotSourceResult {
  const { activation, composition, selectionConfig } = input ?? {} as CanonicalLiveShadowSnapshotSourceInput;
  if (
    !activation?.ready
    || activation.activated !== true
    || !activation.sourceManifestHash
    || !composition?.ready
    || !composition.service
    || !composition.sourceManifestHash
    || !selectionConfig?.ready
    || !selectionConfig.sourceManifestHash
    || !Array.isArray(selectionConfig.constituentRegistry)
    || selectionConfig.constituentRegistry.length === 0
  ) {
    return output(false, null, null, 0, ["CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_NOT_READY"]);
  }

  if (
    activation.readOnly !== true
    || activation.shadowOnly !== true
    || activation.productionImpact !== "NONE"
    || activation.forwardsDownstream !== false
    || activation.affectsDirection !== false
    || activation.affectsVerdict !== false
    || activation.affectsExecution !== false
    || activation.affectsTelegram !== false
    || activation.grantsCandidateAuthority !== false
    || activation.wiredIntoServer !== false
    || activation.failClosed !== true
    || composition.readOnly !== true
    || composition.shadowOnly !== true
    || composition.forwardsDownstream !== false
    || composition.affectsDirection !== false
    || composition.affectsVerdict !== false
    || composition.affectsExecution !== false
    || composition.affectsTelegram !== false
    || composition.grantsCandidateAuthority !== false
    || composition.failClosed !== true
    || selectionConfig.readOnly !== true
    || selectionConfig.affectsDirection !== false
    || selectionConfig.affectsVerdict !== false
    || selectionConfig.affectsExecution !== false
    || selectionConfig.affectsTelegram !== false
    || selectionConfig.grantsCandidateAuthority !== false
    || selectionConfig.failClosed !== true
  ) {
    return output(false, null, null, 0, ["CANONICAL_LIVE_SHADOW_SNAPSHOT_AUTHORITY_BOUNDARY_INVALID"]);
  }

  const hashes = new Set([activation.sourceManifestHash, composition.sourceManifestHash, selectionConfig.sourceManifestHash]);
  if (hashes.size !== 1) {
    return output(false, null, null, 0, ["CANONICAL_LIVE_SHADOW_SNAPSHOT_MANIFEST_HASH_MISMATCH"]);
  }

  if (
    selectionConfig.membershipCount !== selectionConfig.constituentRegistry.length
    || selectionConfig.uniqueInstrumentTokenCount !== new Set(selectionConfig.constituentRegistry.map((entry) => entry.instrumentToken)).size
    || composition.constituentMembershipCount !== selectionConfig.membershipCount
    || composition.uniqueConstituentTokenCount !== selectionConfig.uniqueInstrumentTokenCount
  ) {
    return output(false, null, null, 0, ["CANONICAL_LIVE_SHADOW_SNAPSHOT_REGISTRY_COUNT_MISMATCH"]);
  }

  const serviceStatus = composition.service.status();
  if (
    serviceStatus.started !== true
    || serviceStatus.productionImpact !== "NONE"
    || serviceStatus.readOnly !== true
    || serviceStatus.forwardsDownstream !== false
    || serviceStatus.affectsDirection !== false
    || serviceStatus.affectsVerdict !== false
    || serviceStatus.affectsExecution !== false
    || serviceStatus.affectsTelegram !== false
    || serviceStatus.failClosed !== true
  ) {
    return output(false, null, null, 0, ["CANONICAL_LIVE_SHADOW_SNAPSHOT_SERVICE_STATE_INVALID"]);
  }

  const constituentTicks = composition.service.constituentTicks(input.symbol);
  const snapshot = buildCanonicalShadowSnapshot({
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    asOfMs: input.asOfMs,
    minuteClosed: input.minuteClosed,
    connectionId: input.connectionId,
    instrumentMasterVersion: input.instrumentMasterVersion,
    baseComponents: input.baseComponents,
    constituentRegistry: selectionConfig.constituentRegistry,
    constituentTicks,
    constituentFreshnessMs: input.constituentFreshnessMs,
    freshnessBudgetsMs: input.freshnessBudgetsMs,
    ingestTelemetry: input.ingestTelemetry,
  });

  return output(true, activation.sourceManifestHash, snapshot, constituentTicks.length, []);
}
