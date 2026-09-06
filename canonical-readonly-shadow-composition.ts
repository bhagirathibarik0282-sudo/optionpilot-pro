import { H1LiveExactReadOnlyWebSocketService } from "./h1-live-exact-readonly-websocket-service.js";
import type { H1LiveExactMarketWiringReadinessResult } from "./h1-live-exact-market-wiring-readiness.js";
import type { KiteSocketFactory } from "./kite-websocket-transport.js";
import type { CanonicalSelectionWebSocketConfigAdapterResult } from "./canonical-selection-websocket-config-adapter.js";

export interface CanonicalReadOnlyShadowCompositionInput {
  readiness: H1LiveExactMarketWiringReadinessResult;
  selectionConfig: CanonicalSelectionWebSocketConfigAdapterResult;
  apiKey: string;
  accessToken: string;
  socketFactory?: KiteSocketFactory;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
}

export interface CanonicalReadOnlyShadowCompositionResult {
  version: "CANONICAL_READONLY_SHADOW_COMPOSITION_V1";
  ready: boolean;
  sourceManifestHash: string | null;
  constituentMembershipCount: number;
  uniqueConstituentTokenCount: number;
  service: H1LiveExactReadOnlyWebSocketService | null;
  blockers: string[];
  readOnly: true;
  shadowOnly: true;
  constructsService: true;
  startsSocket: false;
  credentialsExposed: false;
  activatesProduction: false;
  forwardsDownstream: false;
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
  constituentMembershipCount: number,
  uniqueConstituentTokenCount: number,
  service: H1LiveExactReadOnlyWebSocketService | null,
  blockers: string[],
): CanonicalReadOnlyShadowCompositionResult {
  return {
    version: "CANONICAL_READONLY_SHADOW_COMPOSITION_V1",
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    constituentMembershipCount: ready ? constituentMembershipCount : 0,
    uniqueConstituentTokenCount: ready ? uniqueConstituentTokenCount : 0,
    service: ready ? service : null,
    blockers: [...new Set(blockers)],
    readOnly: true,
    shadowOnly: true,
    constructsService: true,
    startsSocket: false,
    credentialsExposed: false,
    activatesProduction: false,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    failClosed: true,
  };
}

/**
 * Composes the already-verified constituent config with the existing H1 read-only WebSocket
 * service. Construction is intentionally separate from start(): this factory never connects a
 * socket, reads environment credentials, publishes downstream, or grants trading authority.
 */
export function composeCanonicalReadOnlyShadowService(
  input: CanonicalReadOnlyShadowCompositionInput,
): CanonicalReadOnlyShadowCompositionResult {
  const config = input?.selectionConfig;
  if (!config?.ready || !config.sourceManifestHash || !Array.isArray(config.constituentRegistry) || config.constituentRegistry.length === 0) {
    return output(false, null, 0, 0, null, ["CANONICAL_SHADOW_COMPOSITION_SELECTION_CONFIG_NOT_READY"]);
  }
  if (
    config.readOnly !== true
    || config.configOnly !== true
    || config.startsSocket !== false
    || config.activatesRuntime !== false
    || config.affectsDirection !== false
    || config.affectsVerdict !== false
    || config.affectsExecution !== false
    || config.affectsTelegram !== false
    || config.grantsCandidateAuthority !== false
    || config.failClosed !== true
  ) {
    return output(false, null, 0, 0, null, ["CANONICAL_SHADOW_COMPOSITION_AUTHORITY_BOUNDARY_INVALID"]);
  }
  const uniqueTokens = new Set(config.constituentRegistry.map((entry) => entry.instrumentToken)).size;
  if (uniqueTokens !== config.uniqueInstrumentTokenCount || config.constituentRegistry.length !== config.membershipCount) {
    return output(false, null, 0, 0, null, ["CANONICAL_SHADOW_COMPOSITION_CONFIG_COUNT_MISMATCH"]);
  }

  try {
    const service = new H1LiveExactReadOnlyWebSocketService({
      readiness: input.readiness,
      apiKey: input.apiKey,
      accessToken: input.accessToken,
      socketFactory: input.socketFactory,
      reconnectDelayMs: input.reconnectDelayMs,
      reconnectMaxAttempts: input.reconnectMaxAttempts,
      constituentRegistry: config.constituentRegistry,
    });
    const status = service.status();
    if (status.started || status.connected || status.forwardsDownstream || status.affectsVerdict || status.affectsExecution || status.affectsTelegram) {
      return output(false, null, 0, 0, null, ["CANONICAL_SHADOW_COMPOSITION_SERVICE_SAFETY_INVALID"]);
    }
    return output(true, config.sourceManifestHash, config.membershipCount, uniqueTokens, service, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "CANONICAL_SHADOW_COMPOSITION_UNKNOWN";
    return output(false, null, 0, 0, null, [message]);
  }
}
