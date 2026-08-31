import test from "node:test";
import assert from "node:assert/strict";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import { KiteShadowRuntimeSupervisor } from "../kite-runtime-shadow-supervisor.js";

class FakeSocket {
  binaryType = "";
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Array<(event:any)=>void>>();
  send(data:string){ this.sent.push(data); }
  close(){ this.emit("close", {}); }
  addEventListener(type:"open"|"message"|"error"|"close", listener:(event:any)=>void){ const rows=this.listeners.get(type)??[]; rows.push(listener); this.listeners.set(type,rows); }
  emit(type:string,event:any){ for(const fn of this.listeners.get(type)??[]) fn(event); }
}

function registry(){ return new KiteImmediateTokenRegistry([{ instrumentToken:1001, symbol:"NIFTY", role:"OPTION", instrumentLabel:"NIFTY26SEP24000CE", expiry:"2026-09-01", strike:24000, optionSide:"CE" }]); }

const core = { cluster:{windowMs:10_000,minSupportingFamilies:1,minEvents:1}, trendFor:()=>({side:"CE" as const,valid:true}) };

test("disabled supervisor is inert and production impact none",()=>{
  const s=new KiteShadowRuntimeSupervisor({enabled:false,registry:registry(),core});
  assert.deepEqual(s.start(),{version:"KITE_RUNTIME_SHADOW_SUPERVISOR_V1",enabled:false,connected:false,state:"DISABLED",subscribedTokenCount:0,lastPacketTimestamp:null,lastDecisionTimestamp:null,reconnectCount:0,staleOrRejectedCount:0,productionImpact:"NONE"});
});

test("enabled supervisor fails closed without credentials",()=>{
  const s=new KiteShadowRuntimeSupervisor({enabled:true,registry:registry(),core});
  assert.throws(()=>s.start(),/CREDENTIALS_REQUIRED/);
});

test("enabled supervisor subscribes exact locked registry in full mode",()=>{
  const socket=new FakeSocket();
  const s=new KiteShadowRuntimeSupervisor({enabled:true,apiKey:"k",accessToken:"t",registry:registry(),core,socketFactory:()=>socket});
  s.start();
  socket.emit("open",{});
  assert.deepEqual(JSON.parse(socket.sent[0]),{a:"subscribe",v:[1001]});
  assert.deepEqual(JSON.parse(socket.sent[1]),{a:"mode",v:["full",[1001]]});
  assert.equal(s.status().connected,true);
  assert.equal(s.status().subscribedTokenCount,1);
  assert.equal(s.status().productionImpact,"NONE");
  s.stop();
});
