/**
 * Mission 1: historical 35-session BANKNIFTY ledger inspection, client-side only.
 * Historical modeled trades are NEVER a SHADOW journal or executable fills.
 * No networking, persistence, broker calls, strategy decisions or server changes.
 */
export const BNF_HISTORY_PANEL_HTML =
 '<details id="bnf-historical-evidence" class="op-bnf-history">'+
 '<summary><strong>BANKNIFTY · Historical 35-day evidence audit</strong> <small>read-only · separate from SHADOW</small></summary>'+
 '<p class="op-bnf-history-note">Import your existing 35-day backtest JSON from this device. Parsed locally in the browser; not uploaded or stored. Ledger profit is modeled, not an executable fill proof.</p>'+
 '<label>Choose backtest JSON <input type="file" id="bnf-history-file" accept=".json,application/json"></label>'+
 '<label>Optional source-price audit JSON <input type="file" id="bnf-history-audit-file" accept=".json,application/json"></label>'+
 '<p class="op-bnf-history-note">The prior Drive LTP audit is not proof of executable fills. Import the ledger first.</p>'+
 '<p id="bnf-history-status" role="status">No historical JSON selected. SHADOW paper journal stays independent.</p>'+
 '<div id="bnf-history-summary"></div>'+
 '<div id="bnf-history-days" class="op-bnf-history-scroll"></div>'+
 '<div id="bnf-history-trades" class="op-bnf-history-scroll"></div>'+
 '</details>';

export const BNF_HISTORY_PANEL_CSS =
 '.op-bnf-history{margin:9px 0;padding:10px;border:1px solid #476277;border-radius:9px;background:#102235;color:#e9f5ff}'+
 '.op-bnf-history summary{cursor:pointer;color:#71f4de;font-size:14px}'+
 '.op-bnf-history small,.op-bnf-history-note{font-size:12px;color:#b9cfda}'+
 '.op-bnf-history label{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}'+
 '.op-bnf-history input{max-width:100%;font-size:12px}'+
 '.op-bnf-history p{font-size:12px;line-height:1.5}'+
 '.op-bnf-history-scroll{overflow-x:auto;max-width:100%}'+
 '.op-bnf-history table{width:100%;border-collapse:collapse;font-size:12px;color:#e9f5ff;min-width:560px}'+
 '.op-bnf-history th,.op-bnf-history td{padding:6px;text-align:left;border-bottom:1px solid #385164;white-space:nowrap}'+
 '.op-bnf-history select{background:#102235;color:#e9f5ff;padding:5px;margin:6px 0}'+
 '.op-bnf-history .op-bnf-warning{color:#ffca90}'+
 '@media(max-width:480px){.op-bnf-history{padding:6px}.op-bnf-history th,.op-bnf-history td{padding:5px}}';

/** Pure analysis; does not infer source LTP matches, missing signals, fills or 1/4/6-lot returns. */
export function deriveBnfHistoricalReview(input: any) {
 const fail=(reason:string)=>({ok:false,reason});
 const isObj=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
 const asTime=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+05:30$/.test(value)
   ?Date.parse(value.replace(' ','T')):NaN;
 const cents=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
 if(!isObj(input)||!isObj(input.parameters)||!isObj(input.summary_metrics)||!Array.isArray(input.daily_ledger)||!Array.isArray(input.trade_by_trade_log))return fail('INVALID_LEDGER_SCHEMA');
 const params=input.parameters, summary=input.summary_metrics;
 if(params.symbol!=='BANKNIFTY'||!Number.isSafeInteger(params.quantity)||params.quantity<=0||
    !finite(params.transaction_cost_per_trade_rs)||params.transaction_cost_per_trade_rs<0)return fail('INVALID_BANKNIFTY_QUANTITY_OR_COST');
 const daily=input.daily_ledger, trades=input.trade_by_trade_log, dates=new Set(), ids=new Set(), groups=new Map();
 let partialDays=0,highCoverageDays=0,zeroTradePartialDays=0;
 for(const row of daily){
  if(!isObj(row)||typeof row.trade_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date)||dates.has(row.trade_date)||
    !Number.isSafeInteger(row.trades)||row.trades<0||!Number.isSafeInteger(row.wins)||row.wins<0||
    !finite(row.net_2lot_rs))return fail('INVALID_OR_DUPLICATE_DAILY_LEDGER');
  dates.add(row.trade_date);
  if(row.feed_type==='Partial'){partialDays++;if(row.trades===0)zeroTradePartialDays++;}
  else if(row.feed_type==='HC_90%+')highCoverageDays++;
  else return fail('UNRECOGNIZED_FEED_COVERAGE');
  groups.set(row.trade_date,[]);
 }
 const bySignal=new Map();
 const events=[];
 let wins=0,net=0,gross=0,missingExpiry=0,holdingViolations=0,priceArithmeticErrors=0;
 for(const t of trades){
  if(!isObj(t)||!Number.isSafeInteger(t.trade_id)||ids.has(t.trade_id)||!dates.has(t.trade_date)||
    !finite(t.entry_ltp)||!finite(t.exit_ltp)||!finite(t.net_2lot_rs)||
    !finite(t.pnl_pts)||!finite(t.signal_ltp)||!Number.isSafeInteger(t.strike)||t.strike<=0||
    !['CE','PE'].includes(t.option_type))return fail('INVALID_OR_DUPLICATE_TRADE_IDENTITY');
  const signal=asTime(t.signal_ts_ist),entry=asTime(t.entry_ts_ist),exit=asTime(t.exit_ts_ist);
  if(![signal,entry,exit].every(Number.isFinite)||signal>=entry||entry>=exit||
    ![t.signal_ts_ist,t.entry_ts_ist,t.exit_ts_ist].every(v=>v.slice(0,10)===t.trade_date))return fail('INVALID_IST_SIGNAL_ENTRY_EXIT_SEQUENCE');
  ids.add(t.trade_id);
  const expectedPts=cents(t.exit_ltp-t.entry_ltp);
  const expectedNet=cents(expectedPts*params.quantity-params.transaction_cost_per_trade_rs);
  if(Math.abs(expectedPts-t.pnl_pts)>0.011||Math.abs(expectedNet-t.net_2lot_rs)>0.011)priceArithmeticErrors++;
  if(t.net_2lot_rs>0)wins++;
  gross+=expectedPts;
  net+=t.net_2lot_rs;
  if(t.expiry==null||t.security_id==null)missingExpiry++;
  if(finite(params.max_hold_sec)&&(exit-entry)/1000>params.max_hold_sec)holdingViolations++;
  groups.get(t.trade_date).push(t);
  const groupKey=t.signal_ts_ist+'|'+t.option_type;
  if(!bySignal.has(groupKey))bySignal.set(groupKey,[]);
  bySignal.get(groupKey).push(t.trade_id);
  events.push({ts:entry,delta:1,cash:t.entry_ltp*params.quantity},{ts:exit,delta:-1,cash:-t.entry_ltp*params.quantity});
 }
 let active=0,capital=0,peakPositions=0,peakEntryPremium=0;
 for(const e of events.sort((a,b)=>a.ts-b.ts||a.delta-b.delta)){
  active+=e.delta;capital+=e.cash;
  if(active>peakPositions)peakPositions=active;
  if(capital>peakEntryPremium)peakEntryPremium=capital;
 }
 const dayRows=daily.map(row=>{
  const dayTrades=groups.get(row.trade_date);
  const actualNet=cents(dayTrades.reduce((a:number,t:any)=>a+t.net_2lot_rs,0));
  const actualWins=dayTrades.filter((t:any)=>t.net_2lot_rs>0).length;
  return {date:row.trade_date,feedType:row.feed_type,trades:row.trades,wins:row.wins,
   modeledNet:row.net_2lot_rs,recomputedNet:actualNet,
   arithmeticOk:row.trades===dayTrades.length&&row.wins===actualWins&&Math.abs(actualNet-row.net_2lot_rs)<0.011,
   tradeDetails:dayTrades.map((t:any)=>({id:t.trade_id,side:t.option_type,strike:t.strike,signalIst:t.signal_ts_ist,
    entryIst:t.entry_ts_ist,exitIst:t.exit_ts_ist,signalLtp:t.signal_ltp,entryLtp:t.entry_ltp,modeledExit:t.exit_ltp,
    modeledNet:t.net_2lot_rs,contractIdentityRecorded:t.expiry!=null&&t.security_id!=null,
    sourceExitLtp:null,sourceMatch:'NOT_IN_LEDGER'}))};
 });
 const netRounded=cents(net);
 return {ok:true,mode:'HISTORICAL_BACKTEST_LEDGER_ONLY',sourceExitVerified:false,shadowJournal:false,
  stats:{sessions:dayRows.length,activeDays:dayRows.filter((x:any)=>x.trades>0).length,zeroTradeDays:dayRows.filter((x:any)=>x.trades===0).length,
   partialDays,highCoverageDays,zeroTradePartialDays,trades:trades.length,wins,losses:trades.length-wins,
   modeledNet:netRounded,winRate:trades.length?cents(wins/trades.length*100):null,
   missingExpiry,holdingViolations,priceArithmeticErrors,peakPositions,peakEntryPremium:cents(peakEntryPremium),
   correlatedSignalClusters:[...bySignal.values()].filter((x:any)=>x.length>1).length,
   dailyReconciliationErrors:dayRows.filter((x:any)=>!x.arithmeticOk).length,
   summaryReconciled:summary.total_days===dayRows.length&&summary.active_days===dayRows.filter((x:any)=>x.trades>0).length&&
    summary.total_trades===trades.length&&Math.abs(netRounded-summary.total_net_profit_rs)<0.011},
  days:dayRows};
}

/** Browser-only importer; the original paper journal endpoint and production storage are untouched. */
export function installBnfHistoricalPanel(){
 const root=document.getElementById('bnf-historical-evidence');
 if(!root)return;
 const file=root.querySelector('#bnf-history-file') as HTMLInputElement|null;
 const status=root.querySelector('#bnf-history-status');
 const auditFile=root.querySelector('#bnf-history-audit-file') as HTMLInputElement|null;
 let loaded:any=null,loadedSha:string|null=null,ledgerName='';
 const summary=root.querySelector('#bnf-history-summary');
 const daysHost=root.querySelector('#bnf-history-days');
 const tradesHost=root.querySelector('#bnf-history-trades');
 if(!file||!auditFile||!status||!summary||!daysHost||!tradesHost)return;
 const el=(tag:string,value:string)=>{const node=document.createElement(tag);node.textContent=value;return node;};
 const table=(headings:string[],rows:string[][])=>{
  const out=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
  for(const h of headings)tr.appendChild(el('th',h));
  thead.appendChild(tr);out.appendChild(thead);
  const body=document.createElement('tbody');
  for(const row of rows){const tr=document.createElement('tr');for(const v of row)tr.appendChild(el('td',v));body.appendChild(tr);}
  out.appendChild(body);return out;
 };
 const fmt=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
 const render=(report:any)=>{
  summary.replaceChildren();daysHost.replaceChildren();tradesHost.replaceChildren();
  const s=report.stats;
  summary.appendChild(el('p',
   'Historical modeled P&L ₹'+fmt(s.modeledNet)+' · '+s.sessions+' selected dates · '+s.trades+
   ' trades · '+s.wins+' wins · '+s.partialDays+' partial-feed dates. NOT execution-certified.'));
  const warnings=[
   'Contract identity missing: '+s.missingExpiry+'/'+s.trades+' trades',
   'Holding-limit exceedances: '+s.holdingViolations,
   'Correlated signal clusters: '+s.correlatedSignalClusters,
   'Peak concurrent positions: '+s.peakPositions+'; peak entry-premium commitment: ₹'+fmt(s.peakEntryPremium),
   'Arithmetic errors: '+s.priceArithmeticErrors+' trade / '+s.dailyReconciliationErrors+' daily; summary matched: '+(s.summaryReconciled?'yes':'no'),
   'Zero-trade partial-feed dates: '+s.zeroTradePartialDays+'. No-trade does not prove no opportunity.',
   s.sourceAuditAttached
    ? '18 Nov Drive audit: '+s.sourcePriceMatch+' matching / '+s.sourcePriceMismatch+' mismatched archived exit LTPs; no executable fill certification.'
    : 'Archived exact-minute exit matches: NOT INCLUDED in this JSON; separate Drive source audit required.'
  ];
  for(const msg of warnings){const p=el('p',msg);p.className='op-bnf-warning';summary.appendChild(p);}
  daysHost.appendChild(el('strong','All selected dates · modeled ledger, not shadow paper receipts'));
  daysHost.appendChild(table(['Date','Feed','Trades','Wins','Modeled net ₹','Arithmetic'],
   report.days.map((d:any)=>[d.date,d.feedType,String(d.trades),String(d.wins),fmt(d.modeledNet),d.arithmeticOk?'MATCH':'CHECK'])));
  const label=el('label','Trade detail date: ');
  const select=document.createElement('select');
  for(const d of report.days){const o=document.createElement('option');o.value=d.date;o.textContent=d.date;select.appendChild(o);}
  label.appendChild(select);tradesHost.appendChild(label);
  const detail=document.createElement('div');tradesHost.appendChild(detail);
  const show=()=>{const day=report.days.find((d:any)=>d.date===select.value);detail.replaceChildren();
   if(!day)return;
   if(!day.tradeDetails.length){detail.appendChild(el('p','No trades reported in this partial/recorded session; valid opportunities NOT ruled out.'));return;}
   detail.appendChild(table(['ID','Side / strike','Signal IST','Entry IST','Exit IST','Entry LTP','Modeled exit','Archived exit','Price check','Net ₹'],
    day.tradeDetails.map((t:any)=>[String(t.id),t.side+' '+t.strike,t.signalIst.slice(11,16),
     t.entryIst.slice(11,16),t.exitIst.slice(11,16),fmt(t.entryLtp),fmt(t.modeledExit),fmt(t.sourceExitLtp),t.sourceMatch,fmt(t.modeledNet)])));
   detail.appendChild(el('p',s.sourceAuditAttached?'Previous Drive audit LTP shown. Expiry is inferred, not recorded; matching LTP does not certify fills.':'Source-matched exit LTP and exact expiry/security ID are unavailable in this ledger. Do not infer fills.'));
  };
  select.addEventListener('change',show);show();
 };
 file.addEventListener('change',async()=>{
  summary.replaceChildren();daysHost.replaceChildren();tradesHost.replaceChildren();
  loaded=null;loadedSha=null;ledgerName='';
 const selected=file.files?.[0];
  if(!selected){status.textContent='No file selected.';return;}
  if(selected.size>10_000_000){status.textContent='File too large (10 MB limit).';return;}
  try{
   const data=JSON.parse(await selected.text());
   const report=deriveBnfHistoricalReview(data);
   if(!report.ok){status.textContent='Rejected: '+report.reason;return;}
   loaded=report;ledgerName=selected.name;
   if(typeof crypto!=='undefined'&&crypto.subtle){
    const digest=await crypto.subtle.digest('SHA-256',await selected.arrayBuffer());
    loadedSha=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
   }
   status.textContent='Read locally: '+selected.name+' · HISTORICAL BACKTEST, not SHADOW.';
   render(report);
  }catch{loaded=null;loadedSha=null;status.textContent='Invalid JSON or local file read failed.';}
 });
 auditFile.addEventListener('change',async()=>{
  const selected=auditFile.files?.[0];if(!selected)return;
  if(!loaded||!loadedSha){status.textContent='Load original ledger first. Secure SHA-256 verification is required.';return;}
  if(selected.size>10_000_000){status.textContent='Audit JSON exceeds 10 MB limit.';return;}
  try{
   const joined=attachBnfHistoricalSourceAudit(loaded,JSON.parse(await selected.text()),loadedSha);
   if(!joined.ok){status.textContent='Audit rejected: '+joined.reason;return;}
   loaded=joined;render(joined);
   status.textContent='Local historical audit matched: '+ledgerName+' + '+selected.name+' · not executable fills.';
  }catch{status.textContent='Audit file cannot be parsed.';}
 });
}

/** Join the PREVIOUS 18-Nov Drive audit, never claim independently rerun source data. */
export function attachBnfHistoricalSourceAudit(base:any,audit:any,ledgerSha:string){
 const fail=(reason:string)=>({ok:false,reason});
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 if(!base?.ok||base.mode!=='HISTORICAL_BACKTEST_LEDGER_ONLY')return fail('LEDGER_REQUIRED');
 if(!audit||audit.schema!=='OPTIONPILOT_BNF_35DAY_DRIVE_AUDIT_COMPARISON_V1'||
    audit.source_ledger_sha256!==ledgerSha||!Array.isArray(audit.per_trade)||
    !Array.isArray(audit.per_traded_day))return fail('AUDIT_SCHEMA_OR_LEDGER_HASH_MISMATCH');
 const originals=new Map<number,any>();
 for(const day of base.days)for(const trade of day.tradeDetails)originals.set(trade.id,{...trade,date:day.date});
 if(originals.size!==base.stats.trades||audit.per_trade.length!==originals.size)return fail('AUDIT_TRADE_COUNT_MISMATCH');
 const byId=new Map<number,any>();let matched=0,mismatched=0;
 for(const a of audit.per_trade){
  const orig=originals.get(a?.trade_id);
  if(!orig||byId.has(a.trade_id)||orig.date!==a.date||orig.strike!==a.strike||orig.side!==a.option_type||
    !finite(a.reported_exit_ltp)||Math.abs(orig.modeledExit-a.reported_exit_ltp)>.011||
    !finite(a.archived_exit_ltp)||a.signal_and_entry_match_codes!=='M / M')return fail('AUDIT_TRADE_IDENTITY_MISMATCH');
  const status=Math.abs(a.reported_exit_ltp-a.archived_exit_ltp)<=.011?'MATCH':'PRICE_MISMATCH';
  if(a.exit_price_status!==status)return fail('AUDIT_PRICE_STATUS_MISMATCH');
  if(status==='MATCH')matched++;else mismatched++;
  byId.set(a.trade_id,a);
 }
 if(!audit.counts||audit.counts.exit_price_match!==matched||audit.counts.exit_price_mismatch!==mismatched)return fail('AUDIT_SUMMARY_COUNTS_MISMATCH');
 const covered=base.days.filter((d:any)=>d.trades>0);
 if(audit.per_traded_day.length!==covered.length)return fail('AUDIT_DATE_COUNT_MISMATCH');
 const byDate=new Map<string,any>();
 for(const d of audit.per_traded_day){
  if(!d||byDate.has(d.date)||!Number.isSafeInteger(d.source_option_minute_count)||
     d.source_option_minute_count<0||d.source_option_minute_count>375||d.minute_denominator!==375||
     !Number.isSafeInteger(d.all_three_match_common_expiry_count))return fail('AUDIT_DATE_INVALID');
  byDate.set(d.date,d);
 }
 for(const day of covered){
  const d=byDate.get(day.date);
  if(!d||d.trades_in_report!==day.trades||
    d.all_three_match_common_expiry_count!==day.tradeDetails.filter((t:any)=>byId.get(t.id)?.exit_price_status==='MATCH').length)
    return fail('AUDIT_DAILY_COVERAGE_MISMATCH');
 }
 return {...base,sourceAuditStatus:'PREVIOUS_DRIVE_AUDIT_NOT_FILL_PROOF',
  stats:{...base.stats,sourceAuditAttached:true,sourcePriceMatch:matched,sourcePriceMismatch:mismatched},
  days:base.days.map((d:any)=>({...d,sourceOptionMinuteCount:byDate.get(d.date)?.source_option_minute_count??null,
   tradeDetails:d.tradeDetails.map((t:any)=>{
     const a=byId.get(t.id);
     return {...t,sourceExitLtp:a?.archived_exit_ltp??null,
       sourceMatch:a?.exit_price_status??'NOT_CHECKED',
       inferredExpiry:a?.inferred_expiry_from_source_match??null};
   })
  }))};
}
