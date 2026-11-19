import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveBnfHistoricalReview,attachBnfHistoricalSourceAudit,BNF_HISTORY_PANEL_HTML} from '../bnf-historical-evidence-panel-v1.js';

function fixture(){
 const dates=Array.from({length:35},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
 const day=dates[0], at=(hhmm:string)=>day+' '+hhmm+':00+05:30';
 const trades=[
  {trade_id:1,trade_date:day,feed_type:'Partial',strike:55000,option_type:'PE',
   signal_ts_ist:at('09:20'),entry_ts_ist:at('09:22'),exit_ts_ist:at('09:30'),
   signal_ltp:110,entry_ltp:100,exit_ltp:132,pnl_pts:32,net_2lot_rs:1845},
  {trade_id:2,trade_date:day,feed_type:'Partial',strike:55100,option_type:'PE',
   signal_ts_ist:at('09:20'),entry_ts_ist:at('09:22'),exit_ts_ist:at('09:33'),
   signal_ltp:130,entry_ltp:120,exit_ltp:98,pnl_pts:-22,net_2lot_rs:-1395},
 ];
 return {project:'OptionPilot Pro',strategy_id:'SYNTHETIC_TEST_FIXTURE',
  parameters:{symbol:'BANKNIFTY',quantity:60,max_hold_sec:1200,transaction_cost_per_trade_rs:75},
  summary_metrics:{total_days:35,active_days:1,total_trades:2,total_net_profit_rs:450},
  daily_ledger:dates.map((d,i)=>({trade_date:d,feed_type:'Partial',trades:i===0?2:0,wins:i===0?1:0,net_2lot_rs:i===0?450:0})),
  trade_by_trade_log:trades};
}
test('historical ledger totals and correlated entries are descriptive, not shadow fills',()=>{
 const x=deriveBnfHistoricalReview(fixture());
 assert.equal(x.ok,true);
 assert.deepEqual({sessions:x.stats.sessions,active:x.stats.activeDays,trades:x.stats.trades,wins:x.stats.wins,net:x.stats.modeledNet},
  {sessions:35,active:1,trades:2,wins:1,net:450});
 assert.equal(x.stats.correlatedSignalClusters,1);
 assert.equal(x.stats.peakPositions,2);
 assert.equal(x.stats.peakEntryPremium,13200);
 assert.equal(x.stats.zeroTradePartialDays,34);
 assert.equal(x.stats.missingExpiry,2);
 assert.equal(x.stats.priceArithmeticErrors,0);
 assert.equal(x.stats.dailyReconciliationErrors,0);
 assert.equal(x.stats.summaryReconciled,true);
 assert.equal(x.sourceExitVerified,false);
 assert.equal(x.shadowJournal,false);
 assert.equal(x.days[0].tradeDetails[0].sourceMatch,'NOT_IN_LEDGER');
});
test('reject malformed or out-of-order timestamps and duplicate trade IDs',()=>{
 const a=fixture();a.trade_by_trade_log[0].exit_ts_ist=a.trade_by_trade_log[0].entry_ts_ist;
 assert.equal(deriveBnfHistoricalReview(a).reason,'INVALID_IST_SIGNAL_ENTRY_EXIT_SEQUENCE');
 const b=fixture();b.trade_by_trade_log[1].trade_id=1;
 assert.equal(deriveBnfHistoricalReview(b).reason,'INVALID_OR_DUPLICATE_TRADE_IDENTITY');
});
test('do not certify arithmetic or strategy from a doctored file',()=>{
 const f=fixture();f.trade_by_trade_log[0].net_2lot_rs=100000;
 const x=deriveBnfHistoricalReview(f);
 assert.equal(x.ok,true);
 assert.equal(x.stats.priceArithmeticErrors,1);
 assert.equal(x.stats.dailyReconciliationErrors,1);
 assert.equal(x.stats.summaryReconciled,false);
 assert.equal(x.sourceExitVerified,false);
 assert.match(BNF_HISTORY_PANEL_HTML,/not uploaded or stored/);
});
test('reject unsupported symbol, no derivatives inference',()=>{
 const f=fixture();f.parameters.symbol='NIFTY';
 assert.equal(deriveBnfHistoricalReview(f).reason,'INVALID_BANKNIFTY_QUANTITY_OR_COST');
});


test('join an exact, independently supplied prior Drive audit only after SHA and identity checks',()=>{
 const ledger=deriveBnfHistoricalReview(fixture());
 const f=fixture(), day=f.daily_ledger[0].trade_date;
 const audit={schema:'OPTIONPILOT_BNF_35DAY_DRIVE_AUDIT_COMPARISON_V1',source_ledger_sha256:'fixture-sha',
  counts:{exit_price_match:1,exit_price_mismatch:1},
  per_traded_day:[{date:day,trades_in_report:2,all_three_match_common_expiry_count:1,
    source_option_minute_count:177,minute_denominator:375}],
  per_trade:[
   {trade_id:1,date:day,strike:55000,option_type:'PE',reported_exit_ltp:132,archived_exit_ltp:132,
    exit_price_status:'MATCH',signal_and_entry_match_codes:'M / M',inferred_expiry_from_source_match:'2026-01-29'},
   {trade_id:2,date:day,strike:55100,option_type:'PE',reported_exit_ltp:98,archived_exit_ltp:97.5,
    exit_price_status:'PRICE_MISMATCH',signal_and_entry_match_codes:'M / M',inferred_expiry_from_source_match:'2026-01-29'}
  ]};
 assert.equal(attachBnfHistoricalSourceAudit(ledger,audit,'wrong-sha').reason,'AUDIT_SCHEMA_OR_LEDGER_HASH_MISMATCH');
 const joined=attachBnfHistoricalSourceAudit(ledger,audit,'fixture-sha');
 assert.equal(joined.ok,true);
 assert.equal(joined.stats.sourcePriceMatch,1);
 assert.equal(joined.stats.sourcePriceMismatch,1);
 assert.equal(joined.days[0].sourceOptionMinuteCount,177);
 assert.equal(joined.days[0].tradeDetails[1].sourceExitLtp,97.5);
 assert.equal(joined.sourceAuditStatus,'PREVIOUS_DRIVE_AUDIT_NOT_FILL_PROOF');
 const edited=structuredClone(audit);
 edited.per_trade[1].strike=99999;
 assert.equal(attachBnfHistoricalSourceAudit(ledger,edited,'fixture-sha').reason,'AUDIT_TRADE_IDENTITY_MISMATCH');
 const doctored=structuredClone(audit);
 doctored.per_trade[1].exit_price_status='MATCH';
 assert.equal(attachBnfHistoricalSourceAudit(ledger,doctored,'fixture-sha').reason,'AUDIT_PRICE_STATUS_MISMATCH');
 assert.match(BNF_HISTORY_PANEL_HTML,/bnf-history-audit-file/);
});
