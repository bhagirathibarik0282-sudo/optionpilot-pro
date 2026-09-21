import test from "node:test";
import assert from "node:assert/strict";
import { H1LiveExactReadOnlyWebSocketService } from "../h1-live-exact-readonly-websocket-service.js";
import { H1LiveExactRawEvidenceStore, H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, buildH1LiveExactGreekTimingRecord } from "../h1-live-exact-raw-evidence-store.js";
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
    instrumentTokens: [99,3,4], mode: "full", selectedSymbolCount: 1, selectedOptionTokenCount: 2,
    lotSizeByOptionToken: { 3: 50, 4: 50 },
    blockers: [], source: "PR241_EXACT_REGISTRY_FILTERED_FOR_LIVE_WS", productionImpact: "NONE",
    startsSocket: false, affectsDirection: false, affectsVerdict: false, affectsExecution: false,
    affectsTelegram: false, activatesShadow: false, infersTokens: false, failClosed: true,
  };
}

function fakeSocket(sent: string[]) {
  const listeners = new Map<string, (event:any)=>void>();
  return {
    binaryType: "", readyState: 1,
    send(data:string){ sent.push(data); },
    close(){ listeners.get("close")?.({}); },
    addEventListener(type:"open"|"message"|"error"|"close", listener:(event:any)=>void){ listeners.set(type, listener); },
    fire(type:string, event:any={}){ listeners.get(type)?.(event); },
  };
}

const depth = { buy:[{price:100,quantity:50,orders:2}], sell:[{price:101,quantity:60,orders:3}] };

test("starts only exact readiness tokens in Kite FULL mode and remains non-authoritative", () => {
  const sent:string[] = [];
  const socket = fakeSocket(sent);
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token", socketFactory: () => socket,
  });
  const initial = service.start();
  assert.equal(initial.started, true);
  assert.equal(initial.rawEvidenceReady, false);
  assert.equal(initial.greekEvidenceStatus, "KITE_MATH_CROSSCHECK_OBSERVING");
  socket.fire("open");
  const status = service.status();
  assert.equal(status.connected, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.forwardsDownstream, false);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsExecution, false);
  assert.equal(status.affectsTelegram, false);
  assert.deepEqual(JSON.parse(sent[0]), { a: "subscribe", v: [99,3,4] });
  assert.deepEqual(JSON.parse(sent[1]), { a: "mode", v: ["full", [99,3,4]] });
});

test("raw exact evidence becomes ready only with fresh spot plus all exact option depth", () => {
  const r = readiness();
  const store = new H1LiveExactRawEvidenceStore(r.registry!, 5_000);
  const t = "2026-09-04T08:10:00.000Z";
  assert.equal(store.ingest({mode:"full",instrumentToken:99,lastPrice:25050,exchangeTimestamp:t,isIndex:true}, t), true);
  assert.equal(store.ingest({mode:"full",instrumentToken:3,lastPrice:100.5,exchangeTimestamp:t,isIndex:false,marketDepth:depth}, t), true);
  let status = store.status(t);
  assert.equal(status.ready, false);
  assert.equal(status.missingTokenCount, 1);
  assert.equal(status.greekEvidenceStatus, "NOT_CONFIGURED");
  assert.equal(store.ingest({mode:"full",instrumentToken:4,lastPrice:99.5,exchangeTimestamp:t,isIndex:false,marketDepth:depth}, t), true);
  status = store.status(t);
  assert.equal(status.ready, true);
  assert.equal(status.freshTokenCount, 3);
  assert.equal(status.symbolReadiness[0].primaryReady, true);
  assert.equal(status.symbolReadiness[0].multiExpiryReady, true);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsExecution, false);
  const stale = store.status("2026-09-04T08:10:06.000Z");
  assert.equal(stale.ready, false);
  assert.equal(stale.staleTokenCount, 3);
});

test("primary evidence can be ready while stale or missing peer expiry remains multi-expiry blocked", () => {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 99, symbol: "BANKNIFTY", role: "SPOT", instrumentLabel: "NIFTY BANK" },
    { instrumentToken: 3, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNSEPCE", expiry: "2026-09-29", strike: 57600, optionSide: "CE" },
    { instrumentToken: 4, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNSEPPE", expiry: "2026-09-29", strike: 57600, optionSide: "PE" },
    { instrumentToken: 5, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNOCTCE", expiry: "2026-10-27", strike: 57600, optionSide: "CE" },
    { instrumentToken: 6, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNOCTPE", expiry: "2026-10-27", strike: 57600, optionSide: "PE" },
  ]);
  const store = new H1LiveExactRawEvidenceStore(registry, 5_000);
  const t = "2026-09-04T08:10:00.000Z";
  store.ingest({mode:"full",instrumentToken:99,lastPrice:57600,exchangeTimestamp:t,isIndex:true}, t);
  store.ingest({mode:"full",instrumentToken:3,lastPrice:500,exchangeTimestamp:t,isIndex:false,marketDepth:depth}, t);
  store.ingest({mode:"full",instrumentToken:4,lastPrice:480,exchangeTimestamp:t,isIndex:false,marketDepth:depth}, t);
  const status = store.status(t);
  assert.equal(status.ready, false);
  assert.equal(status.symbolReadiness[0].primaryExpiry, "2026-09-29");
  assert.equal(status.symbolReadiness[0].primaryReady, true);
  assert.equal(status.symbolReadiness[0].multiExpiryReady, false);
  assert.equal(status.symbolReadiness[0].primaryFreshTokenCount, 3);
  assert.equal(status.symbolReadiness[0].totalFreshTokenCount, 3);
  assert.match(status.symbolReadiness[0].blockers.join("|"), /MULTI_EXPIRY_EVIDENCE_INCOMPLETE/);
});

test("fails closed when readiness is not ready", () => {
  const r = readiness(); r.ready = false; r.registry = null; r.instrumentTokens = [];
  assert.throws(() => new H1LiveExactReadOnlyWebSocketService({ readiness:r, apiKey:"key", accessToken:"token" }), /H1_LIVE_EXACT_READINESS_REQUIRED/);
});

test("fails closed on readiness token mismatch or missing credentials", () => {
  const mismatch = readiness(); mismatch.instrumentTokens = [99,3];
  assert.throws(() => new H1LiveExactReadOnlyWebSocketService({ readiness:mismatch, apiKey:"key", accessToken:"token" }), /TOKEN_MISMATCH/);
  assert.throws(() => new H1LiveExactReadOnlyWebSocketService({ readiness:readiness(), apiKey:"", accessToken:"token" }), /CREDENTIALS_REQUIRED/);
});


test("subscribes exact constituent tokens on the same read-only socket without granting authority", () => {
  const sent:string[] = [];
  const socket = fakeSocket(sent);
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token", socketFactory: () => socket,
    constituentRegistry: [
      { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" },
      { instrumentToken: 102, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" },
    ],
  });
  const initial = service.start();
  assert.equal(initial.subscribedTokenCount, 5);
  socket.fire("open");
  assert.deepEqual(JSON.parse(sent[0]), { a: "subscribe", v: [99,3,4,101,102] });
  assert.deepEqual(JSON.parse(sent[1]), { a: "mode", v: ["full", [99,3,4,101,102]] });
  const constituent = service.constituentEvidenceStatus("NIFTY");
  assert.equal(constituent?.expectedTokenCount, 2);
  assert.equal(constituent?.availableTokenCount, 0);
  assert.deepEqual(constituent?.missingTokens, [101,102]);
  assert.equal(constituent?.readOnly, true);
  assert.equal(constituent?.affectsExecution, false);
  assert.equal(constituent?.affectsTelegram, false);
  assert.deepEqual(service.constituentTicks("NIFTY"), []);
});

test("fails closed when a constituent token overlaps the immediate registry", () => {
  assert.throws(() => new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token",
    constituentRegistry: [
      { instrumentToken: 99, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" },
    ],
  }), /CONSTITUENT_TOKEN_OVERLAP/);
});


test("persists exact option depth once per token per minute without selector policy authority", () => {
  const persisted:any[] = [];
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token",
    rawDepthPersist: (record) => { persisted.push(record); },
    selectorPolicyEnv: {},
  });
  const base = {
    instrumentToken: 3, symbol: "NIFTY" as const, role: "OPTION" as const, instrumentLabel: "NIFTY08CE",
    expiry: "2026-09-08", strike: 25050, optionSide: "CE" as const,
    observedAt: "2026-09-04T08:10:01.000Z", receivedAt: "2026-09-04T08:10:01.100Z",
    ltp: 100.5, bid: 100, ask: 101, bidQty: 50, askQty: 60,
  };
  (service as any).persistRawDepthEvidence([base]);
  (service as any).persistRawDepthEvidence([{...base, observedAt:"2026-09-04T08:10:20.000Z", receivedAt:"2026-09-04T08:10:20.100Z"}]);
  (service as any).persistRawDepthEvidence([{...base, observedAt:"2026-09-04T08:11:00.000Z", receivedAt:"2026-09-04T08:11:00.100Z"}]);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].minuteBucket, "2026-09-04T08:10:00.000Z");
  assert.equal(persisted[0].bidQty, 50);
  assert.equal(persisted[0].askQty, 60);
  assert.equal(persisted[0].thresholdAuthority, "NONE");
  assert.equal(persisted[0].observationalOnly, true);
  assert.equal(persisted[0].affectsSelector, false);
  assert.equal(persisted[0].affectsTelegram, false);
  assert.equal(persisted[0].affectsExecution, false);
  assert.equal(persisted[1].minuteBucket, "2026-09-04T08:11:00.000Z");
});

test("selector runtime quarantines shadow-only policy and keeps raw live socket available", () => {
  const sent:string[] = [];
  const socket = fakeSocket(sent);
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token", socketFactory: () => socket,
    selectorPolicyEnv: {},
  });
  const out = service.start();
  assert.equal(out.started, true);
  assert.equal(out.selectorRuntimePolicyReady, false);
  assert.equal(out.selectorRuntimeAttached, false);
  assert.ok(out.selectorRuntimeBlockers.includes("KITE_H1_EXACT_POLICY_JSON_REQUIRED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  socket.fire("open");
  assert.equal(service.status().connected, true);
  assert.deepEqual(JSON.parse(sent[0]), { a: "subscribe", v: [99,3,4] });
  assert.deepEqual(JSON.parse(sent[1]), { a: "mode", v: ["full", [99,3,4]] });
});


test("builds pre-policy Greek timing evidence without censoring stale or skewed observations", () => {
  const record = buildH1LiveExactGreekTimingRecord({
    instrumentToken: 3,
    symbol: "NIFTY",
    expiry: "2026-09-08",
    strike: 25050,
    optionSide: "CE",
    optionObservedAt: "2026-09-04T08:09:30.000Z",
    optionReceivedAt: "2026-09-04T08:10:10.000Z",
    underlyingInstrumentToken: 99,
    underlyingObservedAt: "2026-09-04T08:09:20.000Z",
    underlyingReceivedAt: "2026-09-04T08:10:09.000Z",
  });
  assert.ok(record);
  assert.equal(record.version, H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND);
  assert.equal(record.minuteBucket, "2026-09-04T08:10:00.000Z");
  assert.equal(record.optionAgeMsAtReceive, 40_000);
  assert.equal(record.underlyingAgeMsAtOptionReceive, 50_000);
  assert.equal(record.underlyingSkewMs, 10_000);
  assert.equal(record.thresholdAuthority, "NONE");
  assert.equal(record.observationalOnly, true);
  assert.equal(record.affectsSelector, false);
  assert.equal(record.affectsTelegram, false);
  assert.equal(record.affectsVerdict, false);
  assert.equal(record.affectsExecution, false);
  assert.equal(record.createsOrders, false);
});

test("persists pre-policy Greek timing once per option token per receive minute", () => {
  const persisted:any[] = [];
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token",
    rawGreekTimingPersist: (record) => { persisted.push(record); },
    selectorPolicyEnv: {},
  });

  (service as any).latestRawSpotTimingBySymbol.set("NIFTY", {
    instrumentToken: 99,
    observedAt: "2026-09-04T08:09:00.000Z",
    receivedAt: "2026-09-04T08:10:00.500Z",
  });

  const option = {
    mode: "full" as const,
    instrumentToken: 3,
    lastPrice: 100.5,
    exchangeTimestamp: "2026-09-04T08:09:30.000Z",
    isIndex: false,
  };
  (service as any).captureRawGreekTimingEvidence(option, "2026-09-04T08:10:01.000Z");
  (service as any).captureRawGreekTimingEvidence(
    { ...option, exchangeTimestamp: "2026-09-04T08:09:31.000Z" },
    "2026-09-04T08:10:20.000Z",
  );
  (service as any).captureRawGreekTimingEvidence(
    { ...option, exchangeTimestamp: "2026-09-04T08:10:30.000Z" },
    "2026-09-04T08:11:01.000Z",
  );

  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].minuteBucket, "2026-09-04T08:10:00.000Z");
  assert.equal(persisted[0].optionAgeMsAtReceive, 31_000);
  assert.equal(persisted[0].underlyingAgeMsAtOptionReceive, 61_000);
  assert.equal(persisted[0].underlyingSkewMs, 30_000);
  assert.equal(persisted[0].thresholdAuthority, "NONE");
  assert.equal(persisted[1].minuteBucket, "2026-09-04T08:11:00.000Z");
});


test("wires Kite-only Greek math cross-check into durable read-only evidence without selector authority", () => {
  const persisted:any[] = [];
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token",
    greekMathCrosscheckPersist: (record) => { persisted.push(record); },
    selectorPolicyEnv: {},
  });

  (service as any).observeRawSpotTiming({
    mode: "full", instrumentToken: 99, lastPrice: 25050,
    exchangeTimestamp: "2026-09-04T08:10:00.000Z", isIndex: true,
  }, "2026-09-04T08:10:00.100Z");

  const option = {
    mode: "full" as const,
    instrumentToken: 3,
    lastPrice: 188.75,
    exchangeTimestamp: "2026-09-04T08:10:00.000Z",
    isIndex: false,
    marketDepth: depth,
  };

  (service as any).captureKiteGreekMathCrosscheckEvidence(option, "2026-09-04T08:10:00.200Z");
  const status = service.status();
  assert.equal(status.greekEvidenceStatus, "KITE_MATH_CROSSCHECK_OBSERVATIONS_AVAILABLE");
  assert.equal(status.greekCrosscheckObservationCount, 1);
  assert.equal(status.greekCrosscheckFailureCount, 0);
  assert.equal(status.greekCrosscheckPolicySemantics, "SHADOW_CALIBRATION_ONLY");
  assert.equal(status.greekCrosscheckPolicyAuthority, "NONE");
  assert.equal(status.selectorRuntimeAttached, false);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsTelegram, false);
  assert.equal(status.affectsExecution, false);

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].version, "H1_KITE_GREEK_MATH_CROSSCHECK_1M_V1");
  assert.equal(persisted[0].instrumentToken, 3);
  assert.equal(persisted[0].thresholdAuthority, "NONE");
  assert.equal(persisted[0].affectsSelector, false);
  assert.equal(persisted[0].affectsBusinessCard, false);
  assert.equal(persisted[0].affectsTelegram, false);
  assert.equal(persisted[0].affectsExecution, false);
  assert.equal(persisted[0].createsOrders, false);
});
