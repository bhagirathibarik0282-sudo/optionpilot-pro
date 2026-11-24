import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {measurePcrSnapshot} from '../dashboard-pcr-sampler.js';

// Exact historical function from 3dd1b4e67134f7756e5e3881829a6f0681992d14.
// Network is replaced with one fixed test response. These are not market quotes.
const historical=readFileSync(new URL('./fixtures/pcr-legacy-function-20261016.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(historical).digest('hex'),'3ab2d1bc91e482484af39c9badf6f2affcc90091febcdf6c15e180af3da171f4');
const compiled=transformSync(historical,{loader:'ts',target:'es2022'}).code;
const date='2026-10-15',expiry='2026-10-19',now=Date.parse(date+'T10:00:00+05:30');
function input(){
 const entries:any[]=[23000,23050].flatMap((strike,i)=>['CE','PE'].map((side,j)=>({token:10+i*2+j,label:'NIFTY26O19'+strike+side,exchange:'NFO',symbol:'NIFTY',role:'OPTION',expiry,strike,side})));
 const quotes=Object.fromEntries(entries.map(e=>['NFO:'+e.label,{instrument_token:e.token,oi:e.side==='CE'?100:200,timestamp:new Date(now).toISOString()}]));
 return {entries,quotes};
}
async function oldValue(entries:any[],quotes:any){
 const context=vm.createContext({fetchKiteQuoteBatched:async()=>quotes});
 vm.runInContext(compiled,context);
 const map=new Map(entries.map(e=>[e.strike+'_'+e.side,{...e,instrument_type:e.side,tradingsymbol:e.label}]));
 return (await context.fetchOptionChainStats('offline-test',map,23000,50,'NFO',7)).fullChainPcr;
}
test('historical and current calculations agree for complete fresh OI and for valid zero PE OI',async()=>{
 for(const zero of [false,true]){const {entries,quotes}=input();if(zero)for(const e of entries)if(e.side==='PE')quotes['NFO:'+e.label].oi=0;
  const value=await oldValue(entries,quotes),current=measurePcrSnapshot(entries,quotes,date,now);
  assert.equal(value,zero?0:2);assert.equal(current.fullPcr,value);assert.equal(current.reportedPcr?.value,value);
 }
});
test('same OI and same identities: only packet age changes the new fresh eligibility, not the reported arithmetic',async()=>{
 const {entries,quotes}=input();quotes['NFO:'+entries[0].label].timestamp=date+' 09:58:00';
 const legacy=await oldValue(entries,quotes),current=measurePcrSnapshot(entries,quotes,date,now);
 assert.equal(legacy,2);assert.equal(current.fullPcr,null);assert.equal(current.coverage.missing,0);assert.equal(current.coverage.stale,1);assert.equal(current.reportedPcr?.value,legacy);
});
test('restoring the old function would silently turn a missing nonzero CE leg into a different full ratio',async()=>{
 const {entries,quotes}=input();delete quotes['NFO:'+entries[0].label];
 assert.equal(await oldValue(entries,quotes),4);
 const current=measurePcrSnapshot(entries,quotes,date,now);assert.equal(current.fullPcr,null);assert.equal(current.reportedPcr,null);assert.equal(current.lastReportedPcr,null);assert.equal(current.coverage.missing,1);
});
