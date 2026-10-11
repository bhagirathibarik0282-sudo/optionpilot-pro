import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDashboardStatistics as derive } from '../dashboard-descriptive-statistics.js';

const symbol = 'NIFTY', expiry = '2026-10-13', contractKey = symbol+'|'+expiry+'|24000|CE', date = '2026-10-12';
function fixture() {
  const options = Array.from({length: 11}, (_, i) => ({symbol, expiry, strike: 24000, option_type: 'CE', dte: 1,
    minute_bucket: new Date(Date.parse(date+'T03:45:00Z')+i*180000).toISOString(), ltp: 100+i, oi: 1000+i*10}));
  return {options, chain: options.map((r,i)=>({...r, full_chain_oi_pcr: 1+i*0.01})), market: options.map((r,i)=>({...r, spot_ltp:24000+i}))};
}
test('signed OI distribution excludes latest observation and uses midrank ties', () => {
  const f = fixture(); f.options[10].oi = 1200;
  const m = derive(f,symbol,expiry,contractKey,date).metrics[3];
  assert.equal(m.delta,110); assert.equal(m.priorChanges,9); assert.equal(m.median,10);
  assert.equal(m.q25,10); assert.equal(m.q75,10); assert.equal(m.percentile,100);
  f.options[10].oi = 1100;
  assert.equal(derive(f,symbol,expiry,contractKey,date).metrics[3].percentile,50);
});
test('latest null, false truth, ambiguous duplicates and gaps are never filled', () => {
  for (const variant of ['null','false','duplicate','gap']) {
    const f:any = fixture();
    if(variant==='null') f.options[10].ltp=null;
    if(variant==='false') f.options[10].truth_verdict='FALSE';
    if(variant==='duplicate') f.options.push({...f.options[10],ltp:999});
    if(variant==='gap') f.options.splice(9,1);
    const m=derive(f,symbol,expiry,contractKey,date).metrics[2];
    assert.equal(m.delta,null,variant); assert.equal(m.percentile,null,variant);
    if(variant==='duplicate') assert.equal(m.conflicts,1);
  }
});
test('exact expiry, symbol, session, contract and DTE cannot contaminate references', () => {
  const f=fixture(); f.options.push({...f.options[10],strike:24100,ltp:999});
  f.chain.push({...f.chain[10],expiry:'2026-10-20',full_chain_oi_pcr:999});
  f.market.push({...f.market[10],symbol:'SENSEX',spot_ltp:999});
  f.options.unshift({...f.options[0],minute_bucket:'2026-10-09T03:42:00Z',ltp:999});
  let model=derive(f,symbol,expiry,contractKey,date);
  assert.equal(model.metrics[2].samples,11); assert.equal(model.metrics[1].samples,11); assert.equal(model.metrics[0].samples,11);
  f.options.find(r=>r.minute_bucket===date+'T04:15:00.000Z' && r.strike===24000)!.dte=0; model=derive(f,symbol,expiry,contractKey,date);
  assert.equal(model.metrics[2].delta,null); assert.equal(model.metrics[2].priorChanges,0);
});
test('small samples, invalid prices and band-only PCR stay unavailable', () => {
  const f:any=fixture(); f.options=f.options.slice(0,3);
  let m=derive(f,symbol,expiry,contractKey,date).metrics[2];
  assert.equal(m.status,'INSUFFICIENT_COMPARISONS'); assert.equal(m.median,null); assert.equal(m.percentile,null);
  f.options[2].ltp=0; assert.equal(derive(f,symbol,expiry,contractKey,date).metrics[2].value,null);
  f.chain.forEach((r:any)=>{delete r.full_chain_oi_pcr; r.band_pcr=9;});
  assert.equal(derive(f,symbol,expiry,contractKey,date).metrics[1].value,null);
});
