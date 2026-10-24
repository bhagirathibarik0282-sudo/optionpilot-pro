import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEventContextLadder,type ContextObservation} from '../rag-event-context-ladder.js';

const event={index:'NIFTY' as const,date:'2026-10-19',timeIst:'09:36',kind:'PDL_LOSS',expiry:'2026-10-19',strike:23150,side:'PE' as const};
const iso=(clock:string,seconds=0)=>new Date(Date.parse('2026-10-19T'+clock+':00+05:30')+seconds*1000).toISOString();
function observation(clock:string,overrides:Partial<ContextObservation>={}):ContextObservation {
  return {index:'NIFTY',family:'PREMIUM',entity:'23150 PE',metric:'LTP',
    expiry:'2026-10-19',strike:23150,side:'PE',
    bucketAt:iso(clock),sourceAt:iso(clock,16),availableAt:iso(clock,22),
    value:100,verified:true,source:'EXISTING_RECORDED',provenance:'source hash:real-fixture-example',
    ...overrides};
}
const run=(observations:ContextObservation[],opts:Record<string,unknown>={})=>
  buildEventContextLadder({event,asOf:iso('10:10'),eventKnownAt:iso('09:36',30),observations,...opts});
test('one button context keeps exact before/event/after lanes distinct, and outcomes opt in only',()=>{
  const observations=[observation('09:33',{value:107}),observation('09:36',{value:100}),
    observation('09:39',{value:94})];
  const historical=run(observations);
  assert.equal(historical.ok,true);
  if(!historical.ok)return;
  assert.deepEqual(historical.lanes.map(l=>l.offsetMinutes),[-30,-15,-3,0]);
  assert.equal(historical.lanes.find(l=>l.offsetMinutes===-3)?.cells[0]?.value,107);
  assert.equal(historical.lanes.find(l=>l.offsetMinutes===0)?.cells[0]?.value,100);
  assert.ok(!historical.lanes.some(l=>l.offsetMinutes===3));
  const withOutcomes=run(observations,{includeOutcomes:true});
  assert.equal(withOutcomes.ok,true);
  if(withOutcomes.ok)assert.equal(withOutcomes.lanes.find(l=>l.offsetMinutes===3)?.cells[0]?.value,94);
});
test('wrong index, strike and side are not silently substituted',()=>{
  const result=run([observation('09:36',{index:'SENSEX'}),
    observation('09:36',{strike:23200}),observation('09:36',{side:'CE'}),
    observation('09:36',{value:0})]);
  assert.equal(result.ok,true);
  if(result.ok) {
    assert.equal(result.coverage.accepted,1);
    assert.equal(result.coverage.rejected,3);
    assert.equal(result.lanes.find(l=>l.offsetMinutes===0)?.cells[0]?.value,0);
  }
});
test('different families and separate stock/sector rows never merge into index movement',()=>{
  const result=run([
    observation('09:36',{family:'SPOT',entity:'NIFTY',metric:'LTP',value:23000,expiry:undefined,strike:undefined,side:undefined}),
    observation('09:36',{family:'HEAVYWEIGHT',entity:'HDFCBANK',metric:'CHANGE_PCT',value:-0.6,weightPct:8.1,weightSource:'official-index-constituent'}),
    observation('09:36',{family:'SECTOR',entity:'FINANCIALS',metric:'CHANGE_PCT',value:-0.3,weightPct:32.3,
      weightSource:undefined,contribution:-5.3,contributionSource:undefined})
  ]);
  assert.equal(result.ok,true);
  if(result.ok){
    const row=result.lanes.find(l=>l.offsetMinutes===0)!.cells;
    assert.equal(row.length,3);
    assert.equal(row.find(x=>x.family==='HEAVYWEIGHT')!.weightPct,8.1);
    assert.equal(row.find(x=>x.family==='SECTOR')!.weightPct,null);
    assert.equal(row.find(x=>x.family==='SECTOR')!.contribution,null);
  }
});
test('conflicting duplicate values are blocked, repeated identical rows deduplicated',()=>{
  const base=observation('09:36',{value:122});
  const c=run([base,base,observation('09:36',{value:123})]);
  assert.equal(c.ok,true);
  if(c.ok){assert.equal(c.coverage.conflicts,1);assert.equal(c.lanes.find(l=>l.offsetMinutes===0)!.cells.length,0);}
  const d=run([base,structuredClone(base)]);
  assert.equal(d.ok,true);
  if(d.ok)assert.equal(d.lanes.find(l=>l.offsetMinutes===0)!.cells.length,1);
});
test('official FII/DII is prior published context, never fabricated intraday flow',()=>{
  const prior=observation('09:36',{
    family:'FII_DII',entity:'FII',metric:'NET_CRORE',source:'OFFICIAL_FII_DII',
    bucketAt:iso('09:36'),sourceAt:'2026-10-16T12:00:00.000Z',availableAt:'2026-10-16T12:05:00.000Z',
    publishedAt:'2026-10-16T12:05:00.000Z',sessionDate:'2026-10-16',value:-500,
    expiry:undefined,strike:undefined,side:undefined
  });
  const future=observation('09:36',{...prior,sessionDate:'2026-10-19',publishedAt:iso('16:00'),
    sourceAt:iso('16:00'),availableAt:iso('16:01'),value:900});
  const r=run([prior,future]);
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.institutionalContext.length,1);assert.equal(r.institutionalContext[0].value,-500);
    assert.equal(r.lanes.every(x=>x.cells.length===0),true);}
});
test('future observation receipt or event-time cutoff cannot leak into a replay state',()=>{
  const o=observation('09:36',{availableAt:iso('09:37')});
  const early=run([o],{asOf:iso('09:36',30)});
  assert.equal(early.ok,true);
  if(early.ok)assert.equal(early.coverage.accepted,0);
  assert.equal(run([o],{asOf:iso('09:35')}).ok,false);
});
test('invalid offset and malformed availableAt fail closed; read-only safety is explicit',()=>{
  assert.equal(run([],{offsets:[2]}).ok,false);
  const r=run([observation('09:36',{availableAt:'yesterday'})]);
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.coverage.rejected,1);assert.equal(r.safety.createsOrders,false);
    assert.equal(r.safety.newDatabase,false);}
});

test('event signature cannot leak a late-delivered observation even with a later as-of',()=>{
  const late=observation('09:36',{availableAt:iso('09:38')});
  const r=run([late],{asOf:iso('10:10')});
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.status,'NO_ACCEPTED_EVIDENCE');assert.equal(r.coverage.accepted,0);}
});
test('quotes after bucket minute or outside regular session are never retrofitted',()=>{
  const r=run([observation('09:36',{availableAt:iso('09:37')}),
    observation('09:36',{sourceAt:iso('09:37')}),
    observation('09:06')],{offsets:[-30,-15,-3,0]});
  assert.equal(r.ok,true);
  if(r.ok)assert.equal(r.coverage.accepted,0);
});
test('PCR/OI for another expiry cannot be attributed to the selected premium',()=>{
  const r=run([
    observation('09:36',{family:'PCR_OI',entity:'Full PCR',metric:'RATIO',expiry:'2026-10-26',strike:undefined,side:undefined}),
    observation('09:36',{family:'PCR_OI',entity:'Full PCR',metric:'RATIO',expiry:'2026-10-19',strike:undefined,side:undefined,value:1.1})
  ]);
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.coverage.accepted,1);assert.equal(r.coverage.rejected,1);}
});
test('weights greater than 100 percent and blank provenance are withheld',()=>{
  const r=run([
    observation('09:36',{family:'HEAVYWEIGHT',entity:'RELIANCE',metric:'CHANGE_PCT',
      weightPct:101,weightSource:'official',contribution:7,contributionSource:' '})
  ]);
  assert.equal(r.ok,true);
  if(r.ok) {
    const c=r.lanes.find(x=>x.offsetMinutes===0)?.cells[0];
    assert.equal(c?.weightPct,null);
    assert.equal(c?.contribution,null);
  }
});
test('FII publication chronology must be internally consistent',()=>{
  const r=run([observation('09:36',{
    family:'FII_DII',entity:'FII',metric:'NET_CRORE',source:'OFFICIAL_FII_DII',
    sessionDate:'2026-10-16',sourceAt:'2026-10-16T12:06:00Z',
    publishedAt:'2026-10-16T12:05:00Z',availableAt:'2026-10-16T12:07:00Z'
  })]);
  assert.equal(r.ok,true);
  if(r.ok)assert.equal(r.institutionalContext.length,0);
});

test('eventKnownAt is mandatory and must be within its event bucket',()=>{
 const input={event,asOf:iso('10:10'),observations:[observation('09:36')]};
 assert.equal(buildEventContextLadder({...input,eventKnownAt:undefined as any}).ok,false);
 assert.equal(buildEventContextLadder({...input,eventKnownAt:iso('09:35',59)}).ok,false);
 assert.equal(buildEventContextLadder({...input,eventKnownAt:iso('09:37')}).ok,false);
 assert.equal(buildEventContextLadder({...input,eventKnownAt:iso('09:36',30),asOf:iso('09:36',29)}).ok,false);
});
test('post-event-known late quote cannot contaminate before/event features',()=>{
 const lateBefore=observation('09:33',{availableAt:iso('09:36',31)});
 const lateEvent=observation('09:36',{availableAt:iso('09:36',40)});
 const accepted=observation('09:36',{value:99,availableAt:iso('09:36',24)});
 const result=run([lateBefore,lateEvent,accepted],{asOf:iso('10:10')});
 assert.equal(result.ok,true);
 if(result.ok){
   assert.equal(result.coverage.accepted,1);
   assert.equal(result.coverage.rejected,2);
   assert.equal(result.lanes.find(x=>x.offsetMinutes===0)?.cells[0]?.value,99);
 }
});
