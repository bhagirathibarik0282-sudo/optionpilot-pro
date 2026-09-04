import {
  buildKiteImmediateTokenRegistryFromMaster,
  type ImmediateRegistryBuildRequest,
  type KiteInstrumentMasterRow,
} from "./kite-immediate-registry-builder.js";
import {
  buildH1CanonicalShadowRegistry,
  type H1CanonicalShadowRegistryBuildResult,
} from "./h1-canonical-shadow-registry-builder.js";

export interface H1KiteMasterCanonicalRegistryBridgeResult extends H1CanonicalShadowRegistryBuildResult {
  source: "KITE_INSTRUMENT_MASTER_EXACT";
  inferredTokens: false;
}

export function buildH1CanonicalRegistryFromKiteMaster(
  rows: KiteInstrumentMasterRow[],
  request: ImmediateRegistryBuildRequest,
): H1KiteMasterCanonicalRegistryBridgeResult {
  try {
    const immediateRegistry = buildKiteImmediateTokenRegistryFromMaster(rows, request);
    const canonical = buildH1CanonicalShadowRegistry(immediateRegistry.entries());
    return {
      ...canonical,
      source: "KITE_INSTRUMENT_MASTER_EXACT",
      inferredTokens: false,
    };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "UNKNOWN_MASTER_REGISTRY_ERROR";
    return {
      version: "H1_CANONICAL_SHADOW_REGISTRY_BUILDER_V1",
      ready: false,
      entries: [],
      blockers: [`KITE_MASTER_REGISTRY_BUILD_FAILED:${message}`],
      productionImpact: "NONE",
      failClosed: true,
      source: "KITE_INSTRUMENT_MASTER_EXACT",
      inferredTokens: false,
    };
  }
}
