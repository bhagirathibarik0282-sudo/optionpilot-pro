import test from "node:test";
import assert from "node:assert/strict";
import { H1LiveExactReadOnlyWebSocketService } from "../h1-live-exact-readonly-websocket-service.js";
import { H1LiveExactRawEvidenceStore } from "../h1-live-exact-raw-evidence-store.js";
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

test("starts only exact readiness tokens in Kite FULL mode and remains non-authoritative", () => {
  const sent:string[] = [];
  const socket = fakeSocket(sent);
  const service = new H1LiveExactReadOnlyWebSocketService({
    readiness: readiness(), apiKey: "key", accessToken: "token", socketFactory: () => socket,
  });
  const initial = service.start();
  assert.equal(initial.started, true);
  assert.equal(initial.rawEvidenceReady, false);
  assert.equal(initial.greekEvidenceStatus, "NOT_CONFIGURED");
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
  const depth = { buy:[{price:100,quantity:50,orders:2}], sell:[{price:101,quantity:60,orders:3}] };
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
  assert.equal(status.missingTokenCount, 0);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsExecution, false);
  const stale = store.status("2026-09-04T08:10:06.000Z");
  assert.equal(stale.ready, false);
  assert.equal(stale.staleTokenCount, 3);
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
