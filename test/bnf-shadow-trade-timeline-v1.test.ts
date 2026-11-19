import test from 'node:test';
import assert from 'node:assert/strict';
import {readBnfShadowTimeline,summarizeBnfShadowTimeline,validBnfTimelineDate} from '../bnf-shadow-trade-timeline-v1.js';

const D='2026-11-18',when=(hhmm:string)=>D+'T'+hhmm+':00+05:30';
const contract=(side:'CE'|'PE',strike:number)=>({symbol:'BANKNIFTY',exchange:'NFO',option_type:side,
 strike,expiry_date:'2026-11-24',tradingsymbol:'BANKNIFTY24NOV'+strike+side,contract_lot_size:30,instrument_token:strike});
function trade(id:string,side:'CE'|'PE',strike:number,values:any={}){
 return {intent_id:id,signal_id:'sig-'+id,mode:'SHADOW',contract:contract(side,strike),
  state:'ENTRY_PENDING',reason:null,requested_qty:60,filled_qty:0,exited_qty:0,
  entry_notional:0,exit_notional:0,signal_ts:when('10:00'),entry_ts:null,closed_at:null,
  exit_requested_ts:null,estimated_cost_inr:75,net_pnl_inr_estimated:null,
  last_quote_ts:when('10:00'),last_receive_ts:when('10:00'),
  ...values};
}
function row(id:string,kind:string,hm:string,t:any,details:any={}){
 return {event_id:'evt-'+id+'-'+kind+'-'+hm,intent_id:id,kind,occurred_at:when(hm),
  payload:JSON.stringify({event_id:'event-'+hm,intent_id:id,kind,occurred_at:when(hm),trade:t,details})};
}
function fixture(){
 const e:any[]=[];
 const a='intent-A',b='intent-B';
 const ta=(v:any)=>trade(a,'PE',55200,v),tb=(v:any)=>trade(b,'CE',55100,v);
 e.push(row(a,'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','10:10',ta({signal_ts:when('10:09')})));
 e.push(row(a,'ENTRY_FILL','10:11',ta({signal_ts:when('10:09'),state:'OPEN',filled_qty:60,entry_notional:6000,entry_ts:when('10:11')}),{source_event_id:'ask-a'}));
 e.push(row(a,'EXIT_REQUESTED','10:18',ta({signal_ts:when('10:09'),state:'EXIT_PENDING',filled_qty:60,entry_notional:6000,entry_ts:when('10:11'),exit_requested_ts:when('10:18'),reason:'STOP_LOSS'})));
 e.push(row(a,'EXIT_FILL','10:19',ta({signal_ts:when('10:09'),state:'CLOSED',filled_qty:60,exited_qty:60,entry_notional:6000,exit_notional:4800,
  entry_ts:when('10:11'),closed_at:when('10:19'),estimated_cost_inr:75,net_pnl_inr_estimated:-1275,reason:'STOP_LOSS'}),{qty:60,price:80,source_event_id:'bid-a'}));
 e.push(row(b,'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','11:05',tb({signal_ts:when('11:04')})));
 e.push(row(b,'ENTRY_FILL','11:06',tb({signal_ts:when('11:04'),state:'OPEN',filled_qty:60,entry_notional:9000,entry_ts:when('11:06')}),{source_event_id:'ask-b'}));
 e.push(row(b,'EXIT_REQUESTED','11:14',tb({signal_ts:when('11:04'),state:'EXIT_PENDING',filled_qty:60,entry_notional:9000,entry_ts:when('11:06'),exit_requested_ts:when('11:14'),reason:'STOP_LOSS'})));
 e.push(row(b,'EXIT_FILL','11:15',tb({signal_ts:when('11:04'),state:'EXIT_PENDING',filled_qty:60,exited_qty:30,entry_notional:9000,exit_notional:3600,
  entry_ts:when('11:06'),reason:'STOP_LOSS'}),{qty:30,price:120,source_event_id:'bid-b-1'}));
 e.push(row(b,'EXIT_FILL','11:16',tb({signal_ts:when('11:04'),state:'CLOSED',filled_qty:60,exited_qty:60,entry_notional:9000,exit_notional:7257,
  entry_ts:when('11:06'),closed_at:when('11:16'),estimated_cost_inr:75,net_pnl_inr_estimated:-1818,reason:'STOP_LOSS'}),{qty:30,price:121.9,source_event_id:'bid-b-2'}));
 return e;
}
test('two paper intents and three partial exits reconcile synthetic -3093; no broker or telegram claims',()=>{
 const report=summarizeBnfShadowTimeline(D,{days:{[D]:{realized_estimated:-3093}}},fixture());
 assert.equal(report.ok,true);
 if(!report.ok)return;
 assert.deepEqual(report.counts,{intents:2,entryFills:2,exitFills:3,exitRequests:2,restartRecovery:0,uniqueIntents:2});
 assert.equal(report.trades.length,2);
 assert.deepEqual(report.trades.map(t=>t.modeledNetInr),[-1275,-1818]);
 assert.equal(report.trades[1].events.filter(e=>e.kind==='EXIT_FILL').length,2);
 assert.deepEqual(report.trades[1].events.filter(e=>e.kind==='EXIT_FILL').map(e=>e.price),[120,121.9]);
 assert.deepEqual(report.trades[1].events.filter(e=>e.kind==='EXIT_FILL').map(e=>e.qty),[30,30]);
 assert.equal(report.reconciliation,'MATCHES_DURABLE_DAILY_ESTIMATE');
 assert.equal(report.sumClosedModeledNetInr,-3093);
 assert.equal(report.actualBrokerFills,false);
 assert.equal(report.telegramDeliveryVerified,false);
 assert.equal(report.brokerOrders,0);
 assert.equal(JSON.stringify(report).includes('BNF_V1:'),false);
});
test('mislabelled exit notional/price fails closed and cannot display invented trade profit',()=>{
 const rows=fixture(),bad=JSON.parse(rows.at(-1)!.payload);
 bad.details.price=122;
 rows[rows.length-1].payload=JSON.stringify(bad);
 const out=summarizeBnfShadowTimeline(D,{days:{[D]:{realized_estimated:-3093}}},rows);
 assert.equal(out.ok,false);
 assert.equal(out.reason,'EXIT_BID_RECEIPT_MISMATCH');
 assert.equal(out.trades.length,0);
});
test('missing accepted signal and daily mismatch stay NOT VERIFIED',()=>{
 const rows=fixture().filter(x=>!(x.kind==='ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED'&&x.intent_id==='intent-A'));
 const report=summarizeBnfShadowTimeline(D,{days:{[D]:{realized_estimated:999}}},rows);
 assert.equal(report.ok,true);
 if(!report.ok)return;
 assert.equal(report.reconciliation,'NOT_VERIFIED');
 assert.ok(report.trades[0].issues.includes('ACCEPTED_SIGNAL_NOT_IN_SELECTED_DAY'));
});
test('strict IST/date and caps reject ambiguous or truncated data',()=>{
 assert.equal(validBnfTimelineDate('2026-02-30'),false);
 assert.equal(validBnfTimelineDate('2026-11-18'),true);
 assert.equal(summarizeBnfShadowTimeline('2026-02-30',{},[]).ok,false);
 const rows=fixture();rows[0].occurred_at='2026-11-18T10:10:00Z';
 assert.equal(summarizeBnfShadowTimeline(D,{days:{}},rows).reason,'JOURNAL_EVENT_IDENTITY_OR_IST_INVALID');
 assert.equal(summarizeBnfShadowTimeline(D,{days:{}},Array.from({length:501},()=>fixture()[0])).reason,'JOURNAL_INVALID_OR_TRUNCATED');
});
test('SELECT-only reader validates one scope and hard-bounds day query',async()=>{
 const queries:any[]=[];
 const result=await readBnfShadowTimeline(D,async(sql,params)=>{
  queries.push({sql,params});
  if(queries.length===1)return {rows:[{scope:'BNF_V1:SECRET:SHADOW',payload:{days:{[D]:{realized_estimated:-3093}}}}]};
  return {rows:fixture()};
 });
 assert.equal(result.ok,true);
 assert.equal(queries.length,2);
 assert.match(queries[0].sql,/^SELECT scope,payload/);
 assert.match(queries[1].sql,/^SELECT occurred_at/);
 assert.match(queries[1].sql,/LIMIT 501$/);
 assert.deepEqual(queries[1].params,['BNF_V1:SECRET:SHADOW',D]);
 const noData=await readBnfShadowTimeline(D,async()=>null);
 assert.equal(noData.reason,'SHADOW_JOURNAL_UNAVAILABLE');
 let calls=0;const ambiguous=await readBnfShadowTimeline(D,async()=>{calls++;return {rows:[{scope:'A'},{scope:'B'}]};});
 assert.equal(ambiguous.reason,'AMBIGUOUS_ACCOUNT_SCOPE');assert.equal(calls,1);
});
