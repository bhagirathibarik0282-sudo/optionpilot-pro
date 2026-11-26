import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptEventBuyerEod} from '../event-buyer-eod-adapter.js';
const date='2026-11-20',symbol='NIFTY',minute_bucket=date+'T09:15:00+05:30',at=date+'T09:15:10+05:30';
const m={symbol,minute_bucket,snapshot_id:'S',backend_timestamp:at,spot_ltp:25400,india_vix:17,calculation_version:'V',freshness_status:'TRUE'};
const o={symbol,minute_bucket,snapshot_id:'S',expiry:'2026-11-23',strike:25400,option_type:'CE',quote_timestamp:at,quote_age_seconds:0,ltp:100,pdh:120,pdl:80,oi:1000,calculation_version:'V'};
const c={symbol,minute_bucket,expiry:o.expiry,full_chain_oi_pcr:0.8,call_wall_strike:25500,put_wall_strike:25400,calculation_version:'V'};
const p={tradeDate:date,symbol,version:'INTRADAY_NOTABLE_EVENT_V1',memoryKey:'E'};
const eod={schemaVersion:'EOD_ARCHIVE_V2',tradingDate:date,marketSnapshots:[m],optionSnapshots:[o],chainStates:[c],researchMemories:[{kind:p.version,payload:p,created_at:at}]};
const replay={ok:true,request:{symbol,tradeDate:date},market:[{...m,truth_verdict:'TRUE'}],options:[{...o,truth_verdict:'TRUE'}],chain:[{...c,truth_verdict:'TRUE'}]};
test('EOD alone never promotes freshness or validation to recorder truth',()=>{const a=adaptEventBuyerEod(eod,symbol);assert.equal(a.recorded.ok,false);assert.equal(a.coverage.qualifiedMarketRows,0);assert.equal(a.memory.availability.events.E,new Date(at).toISOString());assert.equal(a.recorded.chain[0].full_pcr_source,null);});
test('exact independent replay joins only matching rows, chain provenance stays missing',()=>{const a=adaptEventBuyerEod(eod,symbol,replay);assert.equal(a.coverage.qualifiedMarketRows,1);assert.equal(a.coverage.qualifiedOptionRows,1);assert.equal(a.coverage.explicitChainProvenance,0);assert.equal(adaptEventBuyerEod(eod,symbol,{...replay,options:[{...replay.options[0],ltp:101}]}).coverage.qualifiedOptionRows,0);assert.equal(adaptEventBuyerEod(eod,symbol,{...replay,market:[...replay.market,...replay.market]}).coverage.qualifiedMarketRows,0);});
test('duplicate memory cannot supply storage provenance',()=>{const a=adaptEventBuyerEod({...eod,researchMemories:[...eod.researchMemories,...eod.researchMemories]},symbol);assert.equal(a.memory.availability.events.E,undefined);});

test('matching SQL DATE and BIGINT serialized differently yields the same exact option identity',()=>{
 const ref={...replay.options[0],expiry:o.expiry+'T00:00:00.000Z',oi:String(o.oi),truth_marker_created_at:at};
 const inspect=(options:typeof ref[])=>adaptEventBuyerEod(eod,symbol,{...replay,options});
 const result=inspect([ref]);
 assert.equal(result.coverage.qualifiedOptionRows,1);
 assert.equal(result.recorded.options[0].truth_marker_created_at,at);
 assert.equal(inspect([{...ref,oi:'1001'}]).coverage.qualifiedOptionRows,0);
 assert.equal(inspect([{...ref,expiry:o.expiry+'T01:00:00.000Z'}]).coverage.qualifiedOptionRows,0);
 assert.equal(inspect([ref,{...ref,expiry:o.expiry}]).coverage.qualifiedOptionRows,0);
});
