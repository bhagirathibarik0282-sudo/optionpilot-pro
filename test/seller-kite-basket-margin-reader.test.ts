import test from 'node:test';
import assert from 'node:assert/strict';
import { createSellerKiteBasketMarginReader, type SellerMarginRequest } from '../seller-kite-basket-margin-reader.js';

const NOW = Date.parse('2026-10-17T10:00:00Z');
const request: SellerMarginRequest = {snapshotId:'snapshot-1',symbol:'NIFTY',shortToken:11,longToken:12,quantity:65,product:'NRML'};
const rows = [
  '11,NIFTY26OCT25000CE,NIFTY,2026-10-20,25000,CE,NFO-OPT,NFO,65',
  '12,NIFTY26OCT25100CE,NIFTY,2026-10-20,25100,CE,NFO-OPT,NFO,65',
];
const csv = (lines = rows) => 'instrument_token,tradingsymbol,name,expiry,strike,instrument_type,segment,exchange,lot_size\n' + lines.join('\n');
const responseBody = () => ({status:'success',data:{initial:{total:24000},final:{total:18000},orders:[
  {exchange:'NFO',tradingsymbol:'NIFTY26OCT25100CE'},
  {exchange:'NFO',tradingsymbol:'NIFTY26OCT25000CE'},
]}});
const session = {accessToken:'TEST_TOKEN',sessionIdFingerprint:'TEST_SESSION',userId:'TEST_ACCOUNT',
  email:null,loginTime:NOW-1000,expiresAt:NOW+60000,source:'SHARED_DB_AUTHORITY' as const};
function fixture(options: {body?:unknown;csv?:string;profile?:unknown;status?:number;fail?:boolean;
  rotate?:boolean;clock?:number[];inactive?:boolean;expired?:boolean} = {}) {
  const calls:Array<{url:string;init:RequestInit}> = [];
  let authCalls = 0, clockIndex = 0;
  const read = createSellerKiteBasketMarginReader({
    now:() => options.clock?.[clockIndex++] ?? NOW,
    apiKey:() => 'TEST_KEY',
    authority:async () => ({session: {...session,...(options.expired?{expiresAt:NOW}:{}),
      ...(options.rotate && authCalls++ > 0 ? {sessionIdFingerprint:'OTHER_SESSION'} : {})},
      status:{active:!options.inactive} } as any),
    fetchImpl:(async (url,init) => {
      calls.push({url:String(url),init:init || {}});
      if (options.fail) throw new Error('TEST_TOKEN must not escape');
      if (String(url).endsWith('/user/profile')) return Response.json(options.profile ?? {status:'success',data:{user_id:'TEST_ACCOUNT'}});
      if (String(url).endsWith('/instruments')) return new Response(options.csv ?? csv(),{headers:{'Content-Type':'text/csv'}});
      return Response.json(options.body ?? responseBody(),{status:options.status ?? 200});
    }) as typeof fetch,
  });
  return {read,calls};
}

test('binds exact hedge-first two-leg request, account, product and snapshot; mocked response stays TEST_ONLY',async () => {
  const f=fixture(), r=await f.read(request);
  assert.equal(r.status,'PARTIAL');
  if (r.status !== 'PARTIAL') return;
  assert.equal(r.source,'TEST_ONLY'); assert.equal(r.brokerProvenanceVerified,false);
  assert.equal(r.initialMargin,24000); assert.equal(r.finalMargin,18000); assert.equal(r.conservativeMargin,24000);
  assert.equal(r.executionReady,false); assert.equal(r.createsOrders,false); assert.equal(r.affectsExecution,false);
  assert.equal(r.snapshotId,request.snapshotId); assert.match(r.requestBinding,/^[a-f0-9]{64}$/);
  assert.equal(f.calls.length,3);
  for (const call of f.calls) {
    assert.ok(call.url.startsWith('https://api.kite.trade/'));
    assert.equal(call.init.redirect,'error'); assert.ok(call.init.signal);
  }
  assert.equal(f.calls[2].url,'https://api.kite.trade/margins/basket?consider_positions=true');
  assert.equal(f.calls[2].init.method,'POST');
  const basket=JSON.parse(String(f.calls[2].init.body));
  assert.deepEqual(basket.map((x:any)=>[x.transaction_type,x.product,x.quantity]),[['BUY','NRML',65],['SELL','NRML',65]]);
  assert.ok(!JSON.stringify(r).includes('TEST_TOKEN')); assert.ok(!JSON.stringify(r).includes('TEST_ACCOUNT'));
});

for (const [name,change] of [
  ['same token',{longToken:11}], ['partial lot',{quantity:66}], ['unsupported product',{product:'CNC'}],
  ['unsupported index',{symbol:'BANKNIFTY'}], ['missing snapshot',{snapshotId:''}], ['missing token',{shortToken:99}],
] as const) test(`blocks request: ${name}`,async()=>{
  const f=fixture(),r=await f.read({...request,...change} as SellerMarginRequest);
  assert.equal(r.status,'BLOCKED');assert.equal(r.createsOrders,false);
  assert.ok(!f.calls.some(x=>x.url.includes('/margins/')));
});

for (const [name,options] of [
  ['wrong account',{profile:{status:'success',data:{user_id:'OTHER'}}}],
  ['inactive authority',{inactive:true}], ['expired session',{expired:true}],
  ['transport failure',{fail:true}], ['http error',{status:401}],
  ['broker error',{body:{status:'error',message:'TEST_TOKEN'}}],
  ['zero initial margin',{body:{...responseBody(),data:{...responseBody().data,initial:{total:0}}}}],
  ['missing final margin',{body:{status:'success',data:{initial:{total:24000}}}}],
  ['string margin',{body:{...responseBody(),data:{...responseBody().data,final:{total:'18000'}}}}],
  ['wrong response symbol',{body:{...responseBody(),data:{...responseBody().data,orders:[{exchange:'NFO',tradingsymbol:'OTHER'},responseBody().data.orders[1]]}}}],
  ['duplicate response leg',{body:{...responseBody(),data:{...responseBody().data,orders:[responseBody().data.orders[0],responseBody().data.orders[0]]}}}],
  ['session rotated',{rotate:true}],
  ['stale context',{clock:[NOW,NOW,NOW+11000,NOW+11000]}],
  ['clock reversed',{clock:[NOW,NOW,NOW-1,NOW]}],
  ['NaN clock',{clock:[NaN]}],
] as const) test(`fails closed: ${name}`,async()=>{
  const r=await fixture(options).read(request);
  assert.equal(r.status,'BLOCKED');assert.equal(r.brokerProvenanceVerified,false);
  assert.equal(r.createsOrders,false);assert.ok(!JSON.stringify(r).includes('TEST_TOKEN'));
});
for (const [name,lines] of [
  ['duplicate token',[...rows,rows[0]]],
  ['wrong underlying',[rows[0],rows[1].replace(',NIFTY,',',BANKNIFTY,')]],
  ['wrong expiry',[rows[0],rows[1].replace('2026-10-20','2026-10-27')]],
  ['invalid expiry',rows.map(x=>x.replace('2026-10-20','2026-02-30'))],
  ['expired contract',rows.map(x=>x.replace('2026-10-20','2026-10-16'))],
  ['wrong option side',[rows[0],rows[1].replace(',CE,',',PE,')]],
  ['wrong exchange',[rows[0],rows[1].replace(',NFO,',',BFO,')]],
  ['wrong lot size',[rows[0],rows[1].replace(',65',',130')]],
  ['missing lot size',rows.map(x=>x.replace(',65',','))],
  ['reversed hedge',[rows[0],rows[1].replace(',25100,',',24900,')]],
] as const) test(`rejects instrument master mismatch: ${name}`,async()=>{
  const f=fixture({csv:csv([...lines])}),r=await f.read(request);
  assert.equal(r.status,'BLOCKED');assert.ok(!f.calls.some(x=>x.url.includes('/margins/')));
});

test('mutation of caller request during await cannot alter the submitted basket',async()=>{
  const f=fixture(),input={...request},promise=f.read(input);
  input.quantity=130;input.product='MIS';input.snapshotId='other';
  const r=await promise;
  assert.equal(r.status,'PARTIAL');
  if(r.status==='PARTIAL') {assert.equal(r.basket[0].quantity,65);assert.equal(r.basket[0].product,'NRML');assert.equal(r.snapshotId,'snapshot-1');}
});

test('accepts PE hedge direction from master without inventing instrument names',async()=>{
  const peRows=rows.map(x=>x.replaceAll('CE','PE').replaceAll('25100','24900'));
  const body=responseBody();body.data.orders.forEach(x=>{x.tradingsymbol=x.tradingsymbol.replace('CE','PE').replace('25100','24900');});
  const r=await fixture({csv:csv(peRows),body}).read(request);
  assert.equal(r.status,'PARTIAL');
  if(r.status==='PARTIAL'){assert.equal(r.longLeg.strike,24900);assert.equal(r.shortLeg.optionType,'PE');}
});
test('accepts SENSEX only with BFO master identity and whole lot quantity',async()=>{
  const sensexRows=rows.map(x=>x.replaceAll('NIFTY','SENSEX').replaceAll('NFO','BFO').replace(',65',',20'));
  const body=responseBody();body.data.orders.forEach(x=>{x.tradingsymbol=x.tradingsymbol.replace('NIFTY','SENSEX');x.exchange='BFO';});
  const r=await fixture({csv:csv(sensexRows),body}).read({...request,symbol:'SENSEX',quantity:20,product:'MIS'});
  assert.equal(r.status,'PARTIAL');
  if(r.status==='PARTIAL'){assert.equal(r.shortLeg.exchange,'BFO');assert.equal(r.basket[0].product,'MIS');}
});
test('request binding changes with quantity, product or snapshot',async()=>{
  const results=await Promise.all([request,{...request,quantity:130},{...request,product:'MIS' as const},{...request,snapshotId:'other'}].map(x=>fixture().read(x)));
  assert.ok(results.every(x=>x.status==='PARTIAL'));
  assert.equal(new Set(results.map(x=>x.status==='PARTIAL' ? x.requestBinding : '')).size,4);
});
test('request validation rejects non-object JSON before any broker request',async()=>{
  for(const input of [null,undefined,1,'text',[],{}]){
    const f=fixture(),r=await f.read(input as unknown as SellerMarginRequest);
    assert.equal(r.status,'BLOCKED');assert.equal(f.calls.length,0);
  }
});
