import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOct19Evidence } from "../oct19-nifty-chain-event-evidence.js";
import type { H1ReplayHttpResult } from "../h1-replay-http.js";
const date="2026-10-19",expiry=date,symbol="NIFTY";
const iso=(hm:string,seconds=0)=>new Date(date+"T"+hm+":"+String(seconds).padStart(2,"0")+"+05:30").toISOString();
function market(hm:string,spot:number) {return {symbol,minute_bucket:iso(hm),snapshot_id:"s-"+hm,truth_verdict:"TRUE",
  spot_ltp:spot,future_ltp:spot+4,india_vix:14.3,future_oi:123456};}
function chain(hm:string,atm:number,wall:number){return {symbol,expiry,minute_bucket:iso(hm),truth_verdict:"TRUE",
  atm_strike:atm,call_wall_strike:wall,put_wall_strike:22800,full_chain_oi_pcr:1.2};}
function opt(hm:string,side:"CE"|"PE",delta:number,ltp:number,opts:Record<string,unknown>={}) {
 return {symbol,minute_bucket:iso(hm),truth_verdict:"TRUE",snapshot_id:"s-"+hm,
 expiry,strike:side==="CE"?23100:22900,option_type:side,ltp,delta,oi:10000,volume:55000,
 validation_status:"RESEARCH_ELIGIBLE",quote_timestamp:iso(hm,5),quote_age_seconds:5,...opts};
}
function mock(options:Record<string,unknown>[]=[]):H1ReplayHttpResult {
 return {ok:true,mode:"READ_ONLY_H1_3M_REPLAY",productionImpact:"NONE",
 request:{symbol,tradeDate:date,fromTime:"11:32",toTime:"11:33",scope:"FULL"},
 market:[market("11:32",23000),market("11:33",23010)],
 chain:[chain("11:32",23000,23100),chain("11:33",23050,23200)],
 options,canonical:[]};
}
test("same Delta 0.50 accepts different strikes with strict same-minute source timestamps",()=>{
 const rows=[opt("11:32","CE",0.48,155),opt("11:32","PE",-0.49,145),
   opt("11:33","CE",0.5,161),opt("11:33","PE",-0.5,142)];
 const v=summarizeOct19Evidence(mock(rows),"11:33");
 assert.equal(v.status,"RECORDED_MARKET_READ");
 if(v.status!=="RECORDED_MARKET_READ") return;
 assert.deepEqual(v.atmMovedOneMinute,{from:23000,to:23050});
 assert.deepEqual(v.ceWallMovedOneMinute,{from:23100,to:23200});
 assert.equal(v.deltaWeightedOiObservedOnly.fullChain,false);
 assert.equal(v.deltaWeightedOiObservedOnly.ratioPeOverCe,1);
 const p=v.sameDeltaPairs.find(x=>x.target===0.5)!;
 assert.equal(p.status,"VERIFIED_RECORDED_PAIR");
 assert.equal(p.ceStrike,23100);
 assert.equal(p.peStrike,22900);
 assert.equal(p.oneMinuteSpreadChange,9);
 assert.equal(p.oneMinuteSpotChange,10);
 assert.equal(p.oneMinuteDeltaAdjustedResidual,-0.7);
});
test("a flagged diagnostic CE cannot create a trusted same Delta pair",()=>{
 const x=summarizeOct19Evidence(mock([
   opt("11:33","CE",0.5,161,{validation_status:"TIMESTAMP_PRESENT"}),
   opt("11:33","PE",-0.5,142)
 ]),"11:33");
 assert.equal(x.status,"RECORDED_MARKET_READ");
 if(x.status!=="RECORDED_MARKET_READ")return;
 assert.equal(x.sameDeltaPairs.find(z=>z.target===0.5)?.status,"NO_VERIFIED_PAIR");
 assert.equal(x.deltaWeightedOiObservedOnly.ratioPeOverCe,null);
});
test("duplicates and invalid quote-age cannot be silently selected",()=>{
 const q=opt("11:33","CE",0.5,161);
 const x=summarizeOct19Evidence(mock([q,q,opt("11:33","PE",-0.5,142)]),"11:33");
 assert.equal(x.status,"RECORDED_MARKET_READ");
 if(x.status!=="RECORDED_MARKET_READ")return;
 assert.equal(x.sameDeltaPairs.find(z=>z.target===0.5)?.status,"NO_VERIFIED_PAIR");
 const y=summarizeOct19Evidence(mock([
   opt("11:33","CE",0.5,161,{quote_age_seconds:31}),
   opt("11:33","PE",-0.5,142)
 ]),"11:33");
 assert.equal(y.status,"RECORDED_MARKET_READ");
 if(y.status==="RECORDED_MARKET_READ")assert.equal(y.sameDeltaPairs.find(z=>z.target===0.5)?.status,"NO_VERIFIED_PAIR");
});
test("market without trusted truth marker is explicitly withheld",()=>{
 const v=mock([opt("11:33","CE",0.5,161),opt("11:33","PE",-0.5,142)]);
 v.market![1].truth_verdict="FALSE";
 assert.equal(summarizeOct19Evidence(v,"11:33").status,"MARKET_TRUTH_NOT_PROVEN");
});
