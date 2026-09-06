import test from "node:test";
import assert from "node:assert/strict";
import { activateCanonicalReadOnlyShadow } from "../canonical-readonly-shadow-activation-boundary.js";
import type { CanonicalReadOnlyShadowCompositionResult } from "../canonical-readonly-shadow-composition.js";

function serviceStatus(started = false, connected = false) {
  return {
    version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1",
    started,
    connected,
    state: started ? "CONNECTING" : "READY",
    subscribedTokenCount: 5,
    receivedPacketCount: 0,
    rejectedPacketCount: 0,
    lastPacketTimestamp: null,
    rawEvidenceReady: false,
    rawEvidenceExpectedTokenCount: 3,
    rawEvidenceFreshTokenCount: 0,
    rawEvidenceMissingTokenCount: 3,
    rawEvidenceStaleTokenCount: 0,
    rawEvidenceMissing: [],
    rawEvidenceSymbolReadiness: [],
    nearestPeerReadiness: [],
    readOnlyConsumerReadySymbolCount: 0,
    readOnlyConsumerObservations: [],
    readOnlyDirectionReadySymbolCount: 0,
    readOnlyDirectionObservations: [],
    readOnlyShadowInputReadySymbolCount: 0,
    readOnlyShadowInputObservations: [],
    greekEvidenceStatus: "NOT_CONFIGURED",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  } as const;
}

function composition(options?: { prestarted?: boolean; unsafe?: boolean }) {
  let starts = 0;
  let stops = 0;
  let currentStarted = Boolean(options?.prestarted);
  const service = {
    status: () => serviceStatus(currentStarted, false),
    start: () => {
      starts += 1;
      currentStarted = true;
      return serviceStatus(true, false);
    },
    stop: () => {
      stops += 1;
      currentStarted = false;
      return serviceStatus(false, false);
    },
  };
  const result: CanonicalReadOnlyShadowCompositionResult = {
    version: "CANONICAL_READONLY_SHADOW_COMPOSITION_V1",
    ready: true,
    sourceManifestHash: "a".repeat(64),
    constituentMembershipCount: 3,
    uniqueConstituentTokenCount: 2,
    service: service as any,
    blockers: [],
    readOnly: true,
    shadowOnly: true,
    constructsService: true,
    startsSocket: false,
    credentialsExposed: false,
    activatesProduction: false,
    forwardsDownstream: options?.unsafe ? true as false : false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    failClosed: true,
  };
  return { result, starts: () => starts, stops: () => stops };
}

test("default-disabled boundary is ready but never starts the socket", () => {
  const fixture = composition();
  const result = activateCanonicalReadOnlyShadow({ composition: fixture.result, explicitlyEnabled: false });
  assert.equal(result.ready, true);
  assert.equal(result.activated, false);
  assert.equal(result.defaultEnabled, false);
  assert.equal(result.explicitOptInRequired, true);
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.wiredIntoServer, false);
  assert.equal(fixture.starts(), 0);
});

test("explicit opt-in starts only the verified read-only shadow service", () => {
  const fixture = composition();
  const result = activateCanonicalReadOnlyShadow({ composition: fixture.result, explicitlyEnabled: true });
  assert.equal(result.ready, true);
  assert.equal(result.activated, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.shadowOnly, true);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsCandidateAuthority, false);
  assert.equal(fixture.starts(), 1);
  assert.equal(fixture.stops(), 0);
});

test("fails closed on authority tampering or pre-started service", () => {
  const unsafe = composition({ unsafe: true });
  const unsafeResult = activateCanonicalReadOnlyShadow({ composition: unsafe.result, explicitlyEnabled: true });
  assert.equal(unsafeResult.ready, false);
  assert.equal(unsafeResult.activated, false);
  assert.match(unsafeResult.blockers.join("|"), /AUTHORITY_BOUNDARY_INVALID/);
  assert.equal(unsafe.starts(), 0);

  const prestarted = composition({ prestarted: true });
  const prestartedResult = activateCanonicalReadOnlyShadow({ composition: prestarted.result, explicitlyEnabled: true });
  assert.equal(prestartedResult.ready, false);
  assert.equal(prestartedResult.activated, false);
  assert.match(prestartedResult.blockers.join("|"), /PRESTART_STATE_INVALID/);
  assert.equal(prestarted.starts(), 0);
});

test("fails closed when composition is not ready", () => {
  const fixture = composition();
  fixture.result.ready = false;
  const result = activateCanonicalReadOnlyShadow({ composition: fixture.result, explicitlyEnabled: true });
  assert.equal(result.ready, false);
  assert.equal(result.activated, false);
  assert.match(result.blockers.join("|"), /COMPOSITION_NOT_READY/);
  assert.equal(fixture.starts(), 0);
});
