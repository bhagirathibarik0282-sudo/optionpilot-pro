import test from 'node:test';
import assert from 'node:assert/strict';
import { H1LiveExactReadOnlyWebSocketService } from '../h1-live-exact-readonly-websocket-service.js';
import { KiteImmediateTokenRegistry } from '../kite-immediate-token-registry.js';
import type { H1LiveExactMarketWiringReadinessResult } from '../h1-live-exact-market-wiring-readiness.js';
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


function frame(token:number){
 const bytes=new Uint8Array(188),view=new DataView(bytes.buffer);
 view.setUint16(0,1,false);view.setUint16(2,184,false);
 view.setInt32(4,token,false);view.setInt32(8,10000,false);
 view.setInt32(64,Math.floor(Date.now()/1000),false);return bytes.buffer;
}
test('BNF reference uses the same socket and stays outside selector readiness',()=>{
 const sent:string[]=[],socket=fakeSocket(sent),observed:number[]=[],states:string[]=[];
 const service=new H1LiveExactReadOnlyWebSocketService({readiness:readiness(),apiKey:'synthetic',accessToken:'synthetic',
  socketFactory:()=>socket,bnfReferenceTokens:[77],onBnfShadowPackets:ticks=>observed.push(...ticks.map(t=>t.instrumentToken)),
  onBnfShadowState:state=>states.push(state)});
 service.start();socket.fire('open');socket.fire('message',{data:frame(77)});
 assert.deepEqual(JSON.parse(sent[0]).v,[99,3,4,77]);assert.deepEqual(observed,[77]);
 assert.equal(service.status().bnfShadowPaperHostAttached,true);assert.equal(service.status().bnfReferenceTokenCount,1);
 assert.equal(service.status().rawEvidenceExpectedTokenCount,3);assert.equal(service.status().rawEvidenceReady,false);
 assert.equal(service.status().affectsExecution,false);service.stop();assert.equal(states.at(-1),'CLOSED');
});
test('BNF hook failure is isolated and latched without closing the original feed',()=>{
 const sent:string[]=[],socket=fakeSocket(sent);let calls=0;
 const service=new H1LiveExactReadOnlyWebSocketService({readiness:readiness(),apiKey:'synthetic',accessToken:'synthetic',
  socketFactory:()=>socket,bnfReferenceTokens:[77],onBnfShadowPackets:()=>{calls++;throw Error('synthetic-private-error');}});
 service.start();socket.fire('open');
 assert.doesNotThrow(()=>socket.fire('message',{data:frame(77)}));socket.fire('message',{data:frame(77)});
 assert.equal(calls,1);assert.equal(service.status().connected,true);service.stop();
});
test('invalid optional reference subscriptions reject explicitly',()=>{
 for(const bnfReferenceTokens of [[0],[77,77],[-1]])assert.throws(()=>new H1LiveExactReadOnlyWebSocketService({
  readiness:readiness(),apiKey:'synthetic',accessToken:'synthetic',bnfReferenceTokens}),/BNF_REFERENCE_TOKENS_INVALID/);
});
