import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalSelectionWebSocketConfig } from "../canonical-selection-websocket-config-adapter.js";
import type { CanonicalSelectionStartupBridgeResult } from "../canonical-selection-startup-bridge.js";

function bridge(): CanonicalSelectionStartupBridgeResult {
  return {
    version: "CANONICAL_SELECTION_STARTUP_BRIDGE_V1",
    ready: true,
    sourceManifestHash: "a".repeat(64),
    requestCount: 3,
    registry: [
      { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" },
      { instrumentToken: 101, parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 30, source: "KITE_INSTRUMENT_MASTER" },
      { instrumentToken: 102, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" },
    ],
    blockers: [],
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

test("builds config-only fragment and preserves shared-token memberships", () => {
  const out = buildCanonicalSelectionWebSocketConfig(bridge());
  assert.equal(out.ready, true);
  assert.equal(out.membershipCount, 3);
  assert.equal(out.uniqueInstrumentTokenCount, 2);
  assert.equal(out.constituentRegistry.length, 3);
  assert.equal(out.startsSocket, false);
  assert.equal(out.activatesRuntime, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.grantsCandidateAuthority, false);
});

test("fails closed when bridge is not ready or authority boundary is tampered", () => {
  const notReady = bridge(); notReady.ready = false;
  assert.equal(buildCanonicalSelectionWebSocketConfig(notReady).ready, false);
  const tampered = bridge(); (tampered as any).affectsExecution = true;
  const out = buildCanonicalSelectionWebSocketConfig(tampered);
  assert.equal(out.ready, false);
  assert.match(out.blockers.join("|"), /AUTHORITY_BOUNDARY_INVALID/);
});

test("fails closed on duplicate membership or token identity conflict", () => {
  const duplicate = bridge(); duplicate.registry.push({ ...duplicate.registry[0] });
  assert.match(buildCanonicalSelectionWebSocketConfig(duplicate).blockers.join("|"), /MEMBERSHIP_DUPLICATE/);
  const conflict = bridge(); conflict.registry.push({ ...conflict.registry[0], tradingsymbol: "ICICIBANK", parentSymbol: "SENSEX" });
  assert.match(buildCanonicalSelectionWebSocketConfig(conflict).blockers.join("|"), /TOKEN_IDENTITY_CONFLICT:101/);
});
