import test from "node:test";
import assert from "node:assert/strict";
import { H1LiveExactReadOnlyWebSocketService } from "../h1-live-exact-readonly-websocket-service.js";
import type { H1LiveExactMarketWiringReadinessResult } from "../h1-live-exact-market-wiring-readiness.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteSocketFactory, KiteSocketLike } from "../kite-websocket-transport.js";

function readiness(): H1LiveExactMarketWiringReadinessResult {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 1, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY SPOT" },
    { instrumentToken: 2, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY CE", expiry: "2026-09-15", strike: 23300, optionSide: "CE" },
    { instrumentToken: 3, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY PE", expiry: "2026-09-15", strike: 23300, optionSide: "PE" },
  ]);
  return {
    version: "H1_LIVE_EXACT_MARKET_WIRING_READINESS_V1",
    ready: true,
    registry,
    instrumentTokens: registry.tokens(),
    mode: "full",
    selectedSymbolCount: 1,
    selectedOptionTokenCount: 2,
    lotSizeByOptionToken: { 2: 65, 3: 65 },
    blockers: [],
    source: "PR241_EXACT_REGISTRY_FILTERED_FOR_LIVE_WS",
    productionImpact: "NONE",
    startsSocket: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    activatesShadow: false,
    infersTokens: false,
    failClosed: true,
  };
}

function immediateOpenSocketFactory(sent: string[]): KiteSocketFactory {
  return () => {
    const listeners = new Map<string, (event: any) => void>();
    const socket: KiteSocketLike = {
      binaryType: "",
      readyState: 1,
      send(data: string) { sent.push(data); },
      close() { listeners.get("close")?.({}); },
      addEventListener(type, listener) {
        listeners.set(type, listener);
        if (type === "open") listener({});
      },
    };
    return socket;
  };
}

const validPolicy = {
  contracts: [{ instrumentToken: 2, moneyness: "ATM", orderQuantity: 65 }],
  directionPolicy: { maxObservationGapMs: 180_000, minAbsoluteSpotMovePct: 0, maxDirectionAgeMs: 180_000 },
  greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 },
  premiumPolicy: { maxObservationGapMs: 180_000, minPremiumMovePct: 2, minAbsoluteDeltaChange: 0.03, minCurrentGamma: 0.001 },
  burdenPolicy: { maxObservationAgeMs: 60_000, maxAbsThetaPctOfPremium: 10, minIv: 1, maxIv: 100, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
  capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100_000, maxRelativeSpreadPct: 1.5, minBidDepthCoverageMultiple: 2, minAskDepthCoverageMultiple: 2, allowFallbackDte5To7: false },
};

test("raw websocket stays alive while business selector fails closed without explicit production policy", () => {
  const sent: string[] = [];
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(),
    apiKey: "test-key",
    accessToken: "test-token",
    socketFactory: immediateOpenSocketFactory(sent),
    selectorPolicyEnv: {},
  });
  const status = service.start();
  assert.equal(status.started, true);
  assert.equal(status.connected, true);
  assert.equal(status.state, "OPEN");
  assert.equal(status.selectorRuntimePolicyReady, false);
  assert.equal(status.selectorRuntimeAttached, false);
  assert.ok(status.selectorRuntimeBlockers.includes("KITE_H1_EXACT_POLICY_JSON_REQUIRED"));
  assert.equal(sent.length, 2);
  service.stop();
});

test("business selector remains quarantined until direction and Greek validation complete", () => {
  const sent: string[] = [];
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(),
    apiKey: "test-key",
    accessToken: "test-token",
    socketFactory: immediateOpenSocketFactory(sent),
    selectorPolicyEnv: { KITE_H1_EXACT_POLICY_JSON: JSON.stringify(validPolicy) },
  });
  const status = service.start();
  assert.equal(status.started, true);
  assert.equal(status.connected, true);
  assert.equal(status.selectorRuntimePolicyReady, false);
  assert.equal(status.selectorRuntimeAttached, false);
  assert.ok(status.selectorRuntimeBlockers.includes("DIRECTION_POLICY_VALIDATION_REQUIRED"));
  assert.ok(status.selectorRuntimeBlockers.includes("GREEK_POLICY_VALIDATION_REQUIRED"));
  assert.equal(sent.length, 2);
  service.stop();
});
