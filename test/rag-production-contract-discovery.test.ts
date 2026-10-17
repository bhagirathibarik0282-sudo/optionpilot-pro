import test from 'node:test';
import assert from 'node:assert/strict';

const origin='https://optionpilot-pro-v2-production.up.railway.app';
const date='2026-10-16';
const day=(v:unknown)=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?new Date(n).toISOString().slice(0,10):null;};
test('discover real recorded RAG contract from production replay, never fabricate',async()=>{
 for(const symbol of ['NIFTY','SENSEX','BANKNIFTY']){
  const q=new URLSearchParams({symbol,date,from:'09:15',to:'10:00',scope:'FULL'});
  const response=await fetch(origin+'/api/research/h1-replay?'+q,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'REPLAY_HTTP_'+symbol+'_'+response.status);
  const replay:any=await response.json();
  assert.equal(replay.ok,true,'REPLAY_UNAVAILABLE_'+symbol);
  const market=new Map((replay.market??[]).filter((m:any)=>m.truth_verdict==='TRUE'&&m.snapshot_id).map((m:any)=>[String(m.minute_bucket),m]));
  const candidates=(replay.options??[]).filter((o:any)=>o.truth_verdict==='TRUE'&&o.snapshot_id&&Number(o.ltp)>0&&market.get(String(o.minute_bucket))?.snapshot_id===o.snapshot_id);
  const expiryCounts:Record<string,number>={};
  for(const o of candidates){const e=day(o.expiry);if(e)expiryCounts[e]=(expiryCounts[e]??0)+1;}
  console.log('RAG_DISCOVERY',JSON.stringify({symbol,date,marketBuckets:market.size,optionRows:replay.options?.length??0,verifiedIdentityRows:candidates.length,expiryCounts}));
  const groups=new Map<string,Set<string>>();
  for(const o of candidates){const e=day(o.expiry);if(!e)continue;const key=[o.minute_bucket,o.strike,o.option_type].join('|');if(!groups.has(key))groups.set(key,new Set());groups.get(key)!.add(e);}
  const pairs=[...groups.entries()].filter(([,v])=>v.size>=2);
  console.log('RAG_MULTI_DTE_CANDIDATES',JSON.stringify({symbol,count:pairs.length,first:pairs.slice(0,3).map(([key,expiries])=>({key,expiries:[...expiries]}))}));
  assert.ok(candidates.length>0,'NO_TRUTH_ALIGNED_RECORDED_CONTRACT_'+symbol);
 }
});
