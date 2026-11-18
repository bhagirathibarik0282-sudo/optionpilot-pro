/** Shared, display-only 1/2/4/6 SHADOW journal comparison.
 * Same module appears inside live dashboard and after-hours recorded fallback.
 */
export const BNF_SHADOW_DAYWISE_HTML =
 '<section class="op-bnf-daywise" aria-label="BANKNIFTY SHADOW day-wise lot comparison">'+
 '<details open><summary><strong>BANKNIFTY SHADOW · Day-wise 1 / 2 / 4 / 6 lots</strong></summary>'+
 '<p data-bnf-daywise-status role="status">Checking verified paper journal…</p>'+
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

/** No timer, no state mutation outside the DOM; one same-origin read-only request. */
export async function installBnfShadowDaywise(){
 if(typeof document.querySelectorAll!=='function')return;
 const roots=Array.from(document.querySelectorAll('.op-bnf-daywise')) as HTMLElement[];
 if(!roots.length)return;
 const status=(msg:string)=>{for(const root of roots){const p=root.querySelector('[data-bnf-daywise-status]');if(p)p.textContent=msg;}};
 const el=(tag:string,text:string)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 try{
  const response=await fetch('/api/research/recorded-dashboard/bnf-shadow-daywise',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error('JOURNAL_HTTP_UNAVAILABLE');
  const report=await response.json();
  if(report?.mode!=='BNF_SHADOW_DAYWISE_READ_ONLY_V1'||report?.brokerOrders!==0||!Array.isArray(report.days)||!Array.isArray(report.lots)||report.lots.join(',')!=='1,2,4,6')throw Error('JOURNAL_RESPONSE_INVALID');
  if(!report.ok){status('Not verified: '+String(report.reason||'JOURNAL_UNAVAILABLE').slice(0,70));return;}
  if(!report.days.length){status('No verified BANKNIFTY SHADOW paper-journal days yet. No P&L inferred.');return;}
  status('Last '+Math.min(report.days.length,5)+' journal dates · P&L is estimated, not actual broker P&L');
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
 }catch{status('SHADOW day-wise journal unavailable · no inferred fills or P&L');}
}
