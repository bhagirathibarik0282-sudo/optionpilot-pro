import type { CanonicalReadOnlyShadowCompositionResult } from "./canonical-readonly-shadow-composition.js";

export interface CanonicalReadOnlyShadowActivationInput {
  composition: CanonicalReadOnlyShadowCompositionResult;
  explicitlyEnabled: boolean;
}

export interface CanonicalReadOnlyShadowActivationResult {
  version: "CANONICAL_READONLY_SHADOW_ACTIVATION_BOUNDARY_V1";
  ready: boolean;
  activated: boolean;
  sourceManifestHash: string | null;
  blockers: string[];
  explicitOptInRequired: true;
  defaultEnabled: false;
  readOnly: true;
  shadowOnly: true;
  productionImpact: "NONE";
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
  activated: boolean,
  sourceManifestHash: string | null,
  blockers: string[],
): CanonicalReadOnlyShadowActivationResult {
  return {
    version: "CANONICAL_READONLY_SHADOW_ACTIVATION_BOUNDARY_V1",
    ready,
    activated,
    sourceManifestHash: ready ? sourceManifestHash : null,
    blockers: [...new Set(blockers)],
    explicitOptInRequired: true,
    defaultEnabled: false,
    readOnly: true,
    shadowOnly: true,
    productionImpact: "NONE",
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
 * Starts only an already-composed, verified read-only shadow service and only after an explicit
 * caller opt-in. This boundary is intentionally not wired into server.ts and reads no environment
 * flags. Disabled is the default and performs no socket action.
 */
export function activateCanonicalReadOnlyShadow(
  input: CanonicalReadOnlyShadowActivationInput,
): CanonicalReadOnlyShadowActivationResult {
  const composition = input?.composition;
  if (
    !composition?.ready
    || !composition.service
    || !composition.sourceManifestHash
  ) {
    return output(false, false, null, ["CANONICAL_SHADOW_ACTIVATION_COMPOSITION_NOT_READY"]);
  }

  if (
    composition.readOnly !== true
    || composition.shadowOnly !== true
    || composition.constructsService !== true
    || composition.startsSocket !== false
    || composition.credentialsExposed !== false
    || composition.activatesProduction !== false
    || composition.forwardsDownstream !== false
    || composition.affectsDirection !== false
    || composition.affectsVerdict !== false
    || composition.affectsExecution !== false
    || composition.affectsTelegram !== false
    || composition.grantsCandidateAuthority !== false
    || composition.failClosed !== true
  ) {
    return output(false, false, null, ["CANONICAL_SHADOW_ACTIVATION_AUTHORITY_BOUNDARY_INVALID"]);
  }

  const before = composition.service.status();
  if (
    before.started
    || before.connected
    || before.productionImpact !== "NONE"
    || before.readOnly !== true
    || before.forwardsDownstream !== false
    || before.affectsDirection !== false
    || before.affectsVerdict !== false
    || before.affectsExecution !== false
    || before.affectsTelegram !== false
    || before.failClosed !== true
  ) {
    return output(false, false, null, ["CANONICAL_SHADOW_ACTIVATION_PRESTART_STATE_INVALID"]);
  }

  if (input.explicitlyEnabled !== true) {
    return output(true, false, composition.sourceManifestHash, []);
  }

  try {
    const after = composition.service.start();
    if (
      after.started !== true
      || after.productionImpact !== "NONE"
      || after.readOnly !== true
      || after.forwardsDownstream !== false
      || after.affectsDirection !== false
      || after.affectsVerdict !== false
      || after.affectsExecution !== false
      || after.affectsTelegram !== false
      || after.failClosed !== true
    ) {
      composition.service.stop();
      return output(false, false, null, ["CANONICAL_SHADOW_ACTIVATION_POSTSTART_STATE_INVALID"]);
    }
    return output(true, true, composition.sourceManifestHash, []);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "CANONICAL_SHADOW_ACTIVATION_UNKNOWN";
    return output(false, false, null, [message]);
  }
}
