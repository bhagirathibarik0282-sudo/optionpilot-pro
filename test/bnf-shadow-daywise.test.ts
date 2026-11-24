import test from 'node:test';
import assert from 'node:assert/strict';
import { BNF_SHADOW_COMPARISON_LOTS, readBnfShadowDaywise, summarizeBnfShadowDaywise } from '../bnf-shadow-daywise.js';
import { BNF_SHADOW_DAYWISE_HTML, installBnfShadowDaywise } from '../bnf-shadow-daywise-view.js';

const event=(day:string,kind:string,state:string,qty=60,intent='intent1')=>({
 occurred_at:day+'T10:00:00+05:30',kind,intent_id:intent,
 payload:JSON.stringify({intent_id:intent,trade:{state,requested_qty:qty,contract:{contract_lot_size:30}}})
});

test('2-lot original journal is shown without multiplying P&L for 1/4/6 lots',()=>{
 const report=summarizeBnfShadowDaywise({days:{'2026-11-18':{realized_estimated:525,sl_count:1}}},[
  event('2026-11-18','ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','ENTRY_PENDING'),
  event('2026-11-18','ENTRY_FILL','OPEN'),
  event('2026-11-18','EXIT_FILL','CLOSED')
 ]);
 assert.equal(report.ok,true);
 assert.deepEqual(report.lots,BNF_SHADOW_COMPARISON_LOTS);
 assert.equal(report.days.length,1);
 const cells=report.days[0].scenarios;
 assert.deepEqual(cells.map(x=>x.verdict),['NOT_SIMULATED','PAPER_JOURNAL','NOT_SIMULATED','NOT_SIMULATED']);
 assert.deepEqual(cells.filter(x=>x.lots!==2).map(x=>x.estimatedNetPnlInr),[null,null,null]);
 assert.equal(cells[1].estimatedNetPnlInr,525);
 assert.deepEqual([cells[1].intents,cells[1].entryFills,cells[1].exitFills,cells[1].closedTrades],[1,1,1,1]);
 assert.equal(report.brokerOrders,0);
});

test('day-wise journal dates are descending, bounded and do not invent market-day rows',()=>{
 const rows=Array.from({length:7},(_,i)=>event('2026-11-'+String(10+i).padStart(2,'0'),'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','ENTRY_PENDING',60,'intent'+i));
 const report=summarizeBnfShadowDaywise({days:{}},rows);
 assert.equal(report.days.length,5);
 assert.equal(report.days[0].date,'2026-11-16');
 assert.equal(report.days[4].date,'2026-11-12');
 assert.equal(report.days[0].scenarios[1].estimatedNetPnlInr,null);
});

test('1-lot receipts stay 1-lot and never become 2-lot facts',()=>{
 const report=summarizeBnfShadowDaywise({days:{'2026-11-18':{realized_estimated:180}}},[
  event('2026-11-18','ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','ENTRY_PENDING',30),
  event('2026-11-18','ENTRY_FILL','OPEN',30),
  event('2026-11-18','EXIT_FILL','CLOSED',30)
 ]);
 assert.equal(report.days[0].scenarios[0].estimatedNetPnlInr,180);
 assert.equal(report.days[0].scenarios[1].verdict,'NOT_SIMULATED');
});

test('mixed lot sizes within a single journal scope never share estimated daily P&L',()=>{
 const report=summarizeBnfShadowDaywise({days:{}},[
  event('2026-11-17','ENTRY_FILL','OPEN',30),
  event('2026-11-18','ENTRY_FILL','OPEN',60)
 ]);
 assert.equal(report.ok,false);
 assert.equal(report.reason,'MIXED_LOTS_IN_SINGLE_PAPER_SCOPE');
});

test('exit evidence without matching paper entry refuses to report P&L',()=>{
 const result=summarizeBnfShadowDaywise({days:{'2026-11-18':{realized_estimated:500}}},[
  event('2026-11-18','EXIT_FILL','CLOSED',60)
 ]);
 assert.equal(result.ok,false);
 assert.equal(result.reason,'EXIT_RECEIPT_WITHOUT_ENTRY_PROOF');
});

test('invalid contract quantity or broken evidence blocks every reported lot',()=>{
 const report=summarizeBnfShadowDaywise({days:{}},[event('2026-11-18','ENTRY_FILL','OPEN',45)]);
 assert.equal(report.ok,false);
 assert.equal(report.days.length,0);
 assert.equal(report.reason,'JOURNAL_CONTRACT_QUANTITY_UNVERIFIED');
});

test('SELECT-only reader rejects missing schema, ambiguous account scopes and truncated journals',async()=>{
 const missing=await readBnfShadowDaywise(async()=>null);
 assert.equal(missing.reason,'SHADOW_JOURNAL_UNAVAILABLE');
 const duplicate=await readBnfShadowDaywise(async()=>({rows:[{scope:'BNF_V1:A:SHADOW'},{scope:'BNF_V1:B:SHADOW'}]}));
 assert.equal(duplicate.reason,'AMBIGUOUS_SHADOW_ACCOUNT_SCOPE');
 let calls=0;
 const truncated=await readBnfShadowDaywise(async(sql,params)=>{
  assert.match(sql,/^SELECT /);
  calls++;
  if(calls===1){assert.match(sql,/LIMIT 2/);return {rows:[{scope:'BNF_V1:A:SHADOW',payload:JSON.stringify({days:{}})}]};}
  assert.deepEqual(params,['BNF_V1:A:SHADOW']);
  assert.match(sql,/intent_id/);
  return {rows:Array.from({length:1001},()=>event('2026-11-18','ENTRY_FILL','OPEN'))};
 });
 assert.equal(truncated.reason,'JOURNAL_ROW_LIMIT_REACHED');
});

test('shared day-wise UI is browser-safe and contains no broker action',()=>{
 assert.match(BNF_SHADOW_DAYWISE_HTML,/1 \/ 2 \/ 4 \/ 6 lots/);
 assert.doesNotMatch(BNF_SHADOW_DAYWISE_HTML,/broker\/orders|trade\/place/i);
 const client=installBnfShadowDaywise.toString();
 assert.match(client,/recorded-dashboard\/bnf-shadow-daywise/);
 assert.doesNotMatch(client,/setInterval|setTimeout|POST|orders\/place/);
 assert.doesNotThrow(()=>new Function('return ('+client+');'));
});
