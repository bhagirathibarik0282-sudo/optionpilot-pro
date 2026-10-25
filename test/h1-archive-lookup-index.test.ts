import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupBuildBudget,buildReviewedH1LookupIndex,H1_LOOKUP_INDEX_SQL} from '../h1-archive-lookup-index.js';
const metadata=()=>['H1_CANONICAL_MARKET_ARCHIVE','H1_TRUTH_MARKER'].map(kind=>({kind,rows:10000,non_string_symbols:0,unexpected_symbols:0,max_key_bytes:40}));
const provider=()=>({capacityBytes:5000000000,usedBytes:3445784576,observedAt:Date.now()});
test('build budget rejects stale observations, insufficient headroom and unqualified source keys',()=>{
 assert(lookupBuildBudget(metadata(),provider()).operatingReserveBytes>=1073741824);
 for(const p of [{...provider(),observedAt:Date.now()-400000},{...provider(),usedBytes:4400000000},
   {...provider(),capacityBytes:10000000000}])assert.throws(()=>lookupBuildBudget(metadata(),p));
 for(const mutate of [(m:any[])=>m[0].non_string_symbols=1,(m:any[])=>m[0].unexpected_symbols=1,
   (m:any[])=>m[0].max_key_bytes=10000,(m:any[])=>m[0].rows=10000000]){
   const rows=metadata();mutate(rows);assert.throws(()=>lookupBuildBudget(rows,provider()));
 }
});
test('single fixed concurrent index build follows read-only preflight and verifies validity',async()=>{
 const calls:string[]=[];
 const r=await buildReviewedH1LookupIndex({query:async sql=>{
   calls.push(sql);
   return {rows:sql.includes('pg_try_advisory_lock')?[{acquired:true}]:sql.includes('WITH keys')?metadata():
     sql.includes('to_regclass')?[{existing:null,builds:0,older_transactions:0}]:sql.includes('i.indisvalid')?[{valid:true,ready:true,bytes:'524288'}]:[]};
 }},provider());
 assert.equal(r.ok,true);assert.equal(r.marketDataWrites,false);
 assert(calls.indexOf('ROLLBACK')<calls.indexOf(H1_LOOKUP_INDEX_SQL));
 assert.equal(calls.filter(s=>s.startsWith('CREATE INDEX')).length,1);
 assert(calls.every(s=>!/^DROP|^INSERT|^UPDATE|^DELETE/.test(s)));
});
test('existing or busy database never reaches CREATE INDEX',async()=>{
 for(const state of [{existing:'other',builds:0,older_transactions:0},{existing:null,builds:1,older_transactions:0},
   {existing:null,builds:0,older_transactions:1}]){
   const calls:string[]=[];
   await assert.rejects(()=>buildReviewedH1LookupIndex({query:async sql=>{
     calls.push(sql);return {rows:sql.includes('pg_try_advisory_lock')?[{acquired:true}]:sql.includes('WITH keys')?metadata():sql.includes('to_regclass')?[state]:[]};
   }},provider()));
   assert(calls.includes('ROLLBACK'));assert(!calls.includes(H1_LOOKUP_INDEX_SQL));
 }
});
