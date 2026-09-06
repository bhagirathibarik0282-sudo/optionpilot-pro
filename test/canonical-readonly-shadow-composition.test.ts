import test from "node:test";
import assert from "node:assert/strict";
import { composeCanonicalReadOnlyShadowService } from "../canonical-readonly-shadow-composition.js";
import type { CanonicalSelectionWebSocketConfigAdapterResult } from "../canonical-selection-websocket-config-adapter.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { H1LiveExactMarketWiringReadinessResult } from "../h1-live-exact-market-wiring-readiness.js";

function readiness(): H1LiveExactMarketWiringReadinessResult {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 99, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
    { instrumentToken: 3, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY08CE", expiry: "2026-09-08", strike: 25050, optionSide: "CE" },
    { instrumentToken: 4, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY08PE", expiry: "2026-09-08", strike: 25050, optionSide: "PE" },
  ]);
  return {
    version: "H1_LIVE_EXACT_MARKET_WIRING_READINESS_V1", ready: true, registry,
    instrumentTokens: [99, 3, 4], mode: "full", selectedSymbolCount: 1, selectedOptionTokenCount: 2,
    blockers: [], source: "PR241_EXACT_REGISTRY_FILTERED_FOR_LIVE_WS", productionImpact: "NONE",
    startsSocket: false, affectsDirection: false, affectsVerdict: false, affectsExecution: false,
    affectsTelegram: false, activatesShadow: false, infersTokens: false, failClosed: true,
  };
}

function selectionConfig(): CanonicalSelectionWebSocketConfigAdapterResult {
  return {
    version: "CANONICAL_SELECTION_WEBSOCKET_CONFIG_ADAPTER_V1", ready: true,
    sourceManifestHash: "a".repeat(64),
    constituentRegistry: [
      { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" },
      { instrumentToken: 101, parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 28, source: "KITE_INSTRUMENT_MASTER" },
      { instrumentToken: 102, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" },
    ],
    uniqueInstrumentTokenCount: 2, membershipCount: 3, blockers: [], readOnly: true, configOnly: true,
    startsSocket: false, activatesRuntime: false, affectsDirection: false, affectsVerdict: false,
    affectsExecution: false, affectsTelegram: false, grantsCandidateAuthority: false, failClosed: true,
  };
}

test("constructs verified shadow service without starting socket or granting authority", () => {
  const result = composeCanonicalReadOnlyShadowService({
    readiness: readiness(), selectionConfig: selectionConfig(), apiKey: "key", accessToken: "token",
  });
  assert.equal(result.ready, true);
  assert.equal(result.constituentMembershipCount, 3);
  assert.equal(result.uniqueConstituentTokenCount, 2);
  assert.equal(result.startsSocket, false);
  assert.equal(result.credentialsExposed, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  const status = result.service?.status();
  assert.equal(status?.started, false);
  assert.equal(status?.connected, false);
  assert.equal(status?.state, "READY");
  assert.equal(status?.subscribedTokenCount, 5);
  assert.equal(result.service?.constituentEvidenceStatus("NIFTY")?.expectedTokenCount, 2);
  assert.equal(result.service?.constituentEvidenceStatus("BANKNIFTY")?.expectedTokenCount, 1);
  assert.equal("apiKey" in result, false);
  assert.equal("accessToken" in result, false);
});

test("fails closed on unready or authority-tampered constituent config", () => {
  const unready = selectionConfig(); unready.ready = false;
  assert.equal(composeCanonicalReadOnlyShadowService({ readiness: readiness(), selectionConfig: unready, apiKey: "key", accessToken: "token" }).ready, false);
  const tampered = selectionConfig(); (tampered as any).startsSocket = true;
  const result = composeCanonicalReadOnlyShadowService({ readiness: readiness(), selectionConfig: tampered, apiKey: "key", accessToken: "token" });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("|"), /AUTHORITY_BOUNDARY_INVALID/);
});

test("fails closed on count mismatch, readiness overlap, or missing credentials", () => {
  const countMismatch = selectionConfig(); countMismatch.uniqueInstrumentTokenCount = 3;
  assert.match(composeCanonicalReadOnlyShadowService({ readiness: readiness(), selectionConfig: countMismatch, apiKey: "key", accessToken: "token" }).blockers.join("|"), /CONFIG_COUNT_MISMATCH/);

  const overlap = selectionConfig(); overlap.constituentRegistry[0].instrumentToken = 99; overlap.constituentRegistry[1].instrumentToken = 99;
  const overlapResult = composeCanonicalReadOnlyShadowService({ readiness: readiness(), selectionConfig: overlap, apiKey: "key", accessToken: "token" });
  assert.equal(overlapResult.ready, false);
  assert.match(overlapResult.blockers.join("|"), /CONSTITUENT_TOKEN_OVERLAP/);

  const missingCredentials = composeCanonicalReadOnlyShadowService({ readiness: readiness(), selectionConfig: selectionConfig(), apiKey: "", accessToken: "token" });
  assert.equal(missingCredentials.ready, false);
  assert.match(missingCredentials.blockers.join("|"), /CREDENTIALS_REQUIRED/);
});
