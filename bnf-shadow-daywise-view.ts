/** Shared, display-only 1/2/4/6 SHADOW journal comparison.
 * Same module appears inside live dashboard and after-hours recorded fallback.
 */
export const BNF_SHADOW_DAYWISE_HTML =
 '<section class="op-bnf-daywise" aria-label="BANKNIFTY SHADOW day-wise lot comparison">'+
 '<details open><summary><strong>BANKNIFTY SHADOW · Day-wise 1 / 2 / 4 / 6 lots</strong></summary>'+
 '<label>Check date (IST) <input data-bnf-daywise-date type="date" aria-label="SHADOW journal date"></label> '+
 '<button data-bnf-daywise-refresh type="button">Check / Refresh</button>'+
 '<p data-bnf-daywise-status role="status">Checking verified paper journal…</p>'+
 '<p data-bnf-daywise-worker></p>'+
 '<div data-bnf-daywise-table class="op-bnf-daywise-scroll"></div>'+
 '<small>Paper estimates only · 4/6 lots are NOT SIMULATED without independent depth receipts · no real orders</small>'+
 '</details></section>';
export const BNF_SHADOW_DAYWISE_CSS =
 '.op-bnf-daywise{padding:6px 9px;background:#101e2f;color:#e7f0f8;border:1px solid #456074;border-radius:7px;margin:7px 0}'+
 '.op-bnf-daywise summary{cursor:pointer;color:#6cf0db;font-size:13px}'+
 '.op-bnf-daywise p,.op-bnf-daywise small{font-size:11px;color:#d9e4ed}'+
 '.op-bnf-daywise-scroll{max-width:100%;overflow-x:auto}'+
 '.op-bnf-daywise table{border-collapse:collapse;font-size:12px;min-width:560px;width:100%;color:#edf2fa}'+
 '.op-bnf-daywise th,.op-bnf-daywise td{padding:6px;border-bottom:1px solid #345064;text-align:left;white-space:normal;min-width:100px}'+
 '.op-bnf-daywise td:first-child{min-width:90px;font-weight:700}'+
 '.op-bnf-daywise .op-bnf-unverified{color:#ffc993}'+
 '@media(max-width:480px){.op-bnf-daywise{padding:5px}.op-bnf-daywise table{font-size:11px}}';

/** One initial read and explicit refresh; no background polling or broker actions. */
export async function installBnfShadowDaywise(){
 if(typeof document.querySelectorAll!=='function')return;
 const roots=Array.from(document.querySelectorAll('.op-bnf-daywise')) as HTMLElement[];
 if(!roots.length)return;
 const status=(msg:string)=>{for(const root of roots){const p=root.querySelector('[data-bnf-daywise-status]');if(p)p.textContent=msg;}};
 const el=(tag:string,text:string)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const yesterday=new Date(Date.now()+19800000-86400000).toISOString().slice(0,10);
 let checking=false;
 const load=async(date:string)=>{
 if(checking)return;checking=true;
 for(const root of roots){const input=root.querySelector('[data-bnf-daywise-date]') as HTMLInputElement|null;if(input)input.value=date;}
 status('Checking '+date+' paper journal…');
 try{
  const response=await fetch('/api/research/recorded-dashboard/bnf-shadow-daywise?date='+encodeURIComponent(date),{cache:'no-store',credentials:'same-origin'});
  const report=await response.json();
  if(report?.mode!=='BNF_SHADOW_DAYWISE_READ_ONLY_V1'||report?.brokerOrders!==0||!Array.isArray(report.days)||!Array.isArray(report.lots)||report.lots.join(',')!=='1,2,4,6')throw Error('JOURNAL_RESPONSE_INVALID');
  if(!response.ok||!report.ok)throw Error('JOURNAL_UNAVAILABLE');
  const selected=report.selectedDay;
  if(!selected||selected.date!==date)throw Error('DAILY_STATUS_MISSING');
  status(date+' · '+String(selected.status||'UNVERIFIED').replaceAll('_',' ')+' · '+String(selected.explanation||'')+
   ' Latest journal date: '+(report.latestJournalDate||'none')+'. P&L is estimated.');
  const health=selected.workerEvidence;
  const time=(s:any)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false})+' IST':'unverified';
  const n=(v:any)=>Number.isSafeInteger(v)&&v>=0?String(v):'unverified';
  const worker=health?'Last saved worker checkpoint: '+String(health.phase||'UNKNOWN')+' / '+String(health.reason||'UNKNOWN')+
   ' at '+time(health.updatedAt)+'. Last source report '+time(health.lastReportAt)+
   ' · observations '+n(health.lastReportedCounts?.observations)+' · generated signals '+n(health.lastReportedCounts?.signals)+
   ' · rejected '+n(health.lastReportedCounts?.rejected)+' · source '+String(health.sourceReason||'unverified')+
   ' · last exit '+time(health.lastExitAt)+' · exit code '+n(health.exitCode)+
   ' · failure '+String(health.failureStage||'unverified')+' / '+String(health.failureReason||'unverified')+
   '. Counts describe the last reported worker run; full session coverage is unverified.':
   'No saved worker diagnostics for this date. EOD market data cannot establish paper entries, exits or a zero-trade day.';
  for(const root of roots){const p=root.querySelector('[data-bnf-daywise-worker]');if(p)p.textContent=worker;}
  for(const root of roots){
   const host=root.querySelector('[data-bnf-daywise-table]');if(!host)continue;
   const table=document.createElement('table');
   const head=document.createElement('thead'),tr=document.createElement('tr');
   for(const column of ['Date','1 Lot','2 Lots','4 Lots','6 Lots'])tr.appendChild(el('th',column));
   head.appendChild(tr);table.appendChild(head);
   const body=document.createElement('tbody');
   for(const day of report.days.slice(0,5)){
    const line=document.createElement('tr');line.appendChild(el('td',typeof day.date==='string'?day.date:'Invalid date'));
    for(const lots of [1,2,4,6]){
     const item=Array.isArray(day.scenarios)?day.scenarios.find((x:any)=>x?.lots===lots):null;
     const verified=item?.verdict==='PAPER_JOURNAL';
     const cell=el('td',verified?
      ((typeof item.estimatedNetPnlInr==='number'&&Number.isFinite(item.estimatedNetPnlInr)?'₹'+item.estimatedNetPnlInr.toFixed(2)+' est':'P&L unverified')+
       ' · intents '+(Number.isSafeInteger(item.intents)?item.intents:'—')+
       ' · entry/exit receipts '+(Number.isSafeInteger(item.entryFills)?item.entryFills:'—')+'/'+(Number.isSafeInteger(item.exitFills)?item.exitFills:'—'))
      :'NOT SIMULATED');
     if(!verified)cell.classList.add('op-bnf-unverified');
     line.appendChild(cell);
    }
    body.appendChild(line);
   }
   table.appendChild(body);host.replaceChildren(table);
  }
 }catch{status('SHADOW day-wise journal unavailable · no inferred fills or P&L');
  for(const root of roots){root.querySelector('[data-bnf-daywise-table]')?.replaceChildren();const p=root.querySelector('[data-bnf-daywise-worker]');if(p)p.textContent='Worker diagnostics not verified for the requested date.';}
 }finally{checking=false;}
 };
 for(const root of roots){const button=root.querySelector('[data-bnf-daywise-refresh]') as HTMLButtonElement|null;
  if(button)button.onclick=()=>{const input=root.querySelector('[data-bnf-daywise-date]') as HTMLInputElement|null;if(input?.value)void load(input.value);};}
 await load(yesterday);
}
