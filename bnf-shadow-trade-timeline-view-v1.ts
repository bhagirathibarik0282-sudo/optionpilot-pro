/** Owner-gated, read-only display of durable BANKNIFTY SHADOW PAPER events.
 * No credential persistence, URL token, automatic polling, or broker/Telegram sends.
 */
export const BNF_SHADOW_TIMELINE_HTML=
 '<details id="bnf-shadow-timeline" class="op-bnf-paper-timeline">'+
 '<summary><strong>BANKNIFTY · SHADOW Signal → Entry → Exit</strong> <small>private paper-event timeline</small></summary>'+
 '<p>Historical paper simulation, not real broker execution. Requires the existing Railway RESEARCH_ADMIN_TOKEN to view private contract/event details.</p>'+
 '<div class="op-bnf-timeline-controls">'+
 '<label>Date (IST) <input id="bnf-shadow-timeline-date" type="date" value="2026-11-18"></label>'+
 '<label>Admin access key <input id="bnf-shadow-timeline-key" type="password" autocomplete="off" spellcheck="false" placeholder="Not saved"></label>'+
 '<button type="button" id="bnf-shadow-timeline-load">Show paper events</button></div>'+
 '<p id="bnf-shadow-timeline-state" role="status">Not loaded. This card never sends Telegram alerts or broker orders.</p>'+
 '<div id="bnf-shadow-timeline-data"></div>'+
 '</details>';
export const BNF_SHADOW_TIMELINE_CSS=
 '.op-bnf-paper-timeline{background:#142237;color:#e6f4ff;border:1px solid #385971;margin:10px 0;border-radius:9px;padding:10px}'+
 '.op-bnf-paper-timeline summary{cursor:pointer;color:#6eebde}'+
 '.op-bnf-paper-timeline p,.op-bnf-paper-timeline small{font-size:12px;color:#c6d6df}'+
 '.op-bnf-timeline-controls{display:flex;flex-wrap:wrap;gap:9px;align-items:flex-end}'+
 '.op-bnf-timeline-controls label{display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:155px;max-width:100%}'+
 '.op-bnf-timeline-controls input{max-width:100%;background:#0b1729;color:#f3f8ff;border:1px solid #44617d;border-radius:6px;padding:8px}'+
 '.op-bnf-timeline-controls button{border:1px solid #59bcae;color:#052622;background:#7bf2db;padding:8px;border-radius:6px;cursor:pointer;font-weight:700}'+
 '.op-bnf-paper-timeline article{margin:11px 0;padding:8px;border:1px solid #33536b;border-radius:7px}'+
 '.op-bnf-paper-timeline article h4{margin:2px 0 6px;font-size:13px}'+
 '.op-bnf-paper-timeline article p{margin:4px 0}'+
 '.op-bnf-paper-timeline table{width:100%;border-collapse:collapse;font-size:12px}'+
 '.op-bnf-paper-timeline th,.op-bnf-paper-timeline td{border-bottom:1px solid #36516c;padding:5px;text-align:left}'+
 '.op-bnf-paper-timeline .scroll{overflow-x:auto}'+
 '.op-bnf-paper-timeline .warn{color:#ffc58b}'+
 '@media(max-width:500px){.op-bnf-paper-timeline{padding:7px}.op-bnf-timeline-controls label{flex:1 1 140px}.op-bnf-paper-timeline table{font-size:11px}}';

export function installBnfShadowTimeline(){
 const root=document.getElementById('bnf-shadow-timeline');
 if(!root)return;
 const date=root.querySelector('#bnf-shadow-timeline-date') as HTMLInputElement|null;
 const key=root.querySelector('#bnf-shadow-timeline-key') as HTMLInputElement|null;
 const go=root.querySelector('#bnf-shadow-timeline-load') as HTMLButtonElement|null;
 const state=root.querySelector('#bnf-shadow-timeline-state');
 const host=root.querySelector('#bnf-shadow-timeline-data');
 if(!date||!key||!go||!state||!host)return;
 const add=(parent:Element,tag:string,value:string,cls='')=>{
  const elem=document.createElement(tag);elem.textContent=value;if(cls)elem.className=cls;parent.appendChild(elem);return elem;
 };
 const money=(n:any)=>typeof n==='number'&&Number.isFinite(n)?'₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'NOT VERIFIED';
 const ts=(v:any)=>typeof v==='string'&&v.length>=19?v.slice(11,19)+' IST':'—';
 const render=(report:any)=>{
  host.replaceChildren();
  add(host,'p','Trade-level paper records · '+report.date+' · NOT actual fills');
  const counts=report.counts||{};
  add(host,'p','Intents '+(counts.intents??'—')+' · entry receipts '+(counts.entryFills??'—')+
   ' · exit receipts '+(counts.exitFills??'—')+' · estimated daily P&L '+money(report.dailyEstimatedNetInr));
  add(host,'p','Reconciliation: '+report.reconciliation+
   ' · Telegram delivery: NOT LINKED · Source: durable paper journal.',report.reconciliation==='NOT_VERIFIED'?'warn':'');
  if(!report.trades?.length){add(host,'p','No paper events found for this date. This does not prove no market signals occurred.');return;}
  for(const trade of report.trades){
   const a=document.createElement('article');
   add(a,'h4','Paper intent '+trade.number+' · '+trade.side+' '+trade.strike+' · expiry '+trade.expiry);
   add(a,'p','Contract '+trade.tradingsymbol+' · '+trade.lots+' lots · requested '+trade.requestedQty+
      ' · filled '+trade.filledQty+' · exited '+trade.exitedQty);
   add(a,'p','Signal '+ts(trade.signalIst)+' · accepted '+ts(trade.intentIst)+
      ' · entry '+ts(trade.entryIst)+' · exit requested '+ts(trade.exitRequestedIst)+' · closed '+ts(trade.closedIst));
   add(a,'p','Estimated trade net '+money(trade.modeledNetInr)+' · cost '+money(trade.estimatedCostInr)+
      ' · final reason '+(trade.lastReason||'NOT RECORDED'),trade.paperReconciled?'':'warn');
   if(trade.issues?.length)add(a,'p','Evidence flags: '+trade.issues.join(', '),'warn');
   const scroll=document.createElement('div');scroll.className='scroll';
   const table=document.createElement('table');const thead=document.createElement('thead'),head=document.createElement('tr');
   for(const h of ['Event time IST','Journal event','Qty','Simulated price','Exchange quote IST','Reason'])add(head,'th',h);
   thead.appendChild(head);table.appendChild(thead);const body=document.createElement('tbody');
   for(const e of trade.events){
    const tr=document.createElement('tr');
    const price=e.price==null?'—':money(e.price)+(e.priceRole==='SIMULATED_BID'?' bid':e.priceRole==='SIMULATED_ASK'?' ask':'');
    for(const cell of [ts(e.atIst),e.kind,e.qty==null?'—':String(e.qty),price,ts(e.exchangeQuoteIst),e.reason||'—'])add(tr,'td',cell);
    body.appendChild(tr);
   }
   table.appendChild(body);scroll.appendChild(table);a.appendChild(scroll);host.appendChild(a);
  }
 };
 go.addEventListener('click',async()=>{
  const selected=date.value,token=key.value;key.value='';
  host.replaceChildren();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(selected)||!token){state.textContent='Select a date and enter your private admin key. It is not stored.';return;}
  go.disabled=true;state.textContent='Reading private paper journal (read-only)…';
  try{
   const response=await fetch('/api/research/recorded-dashboard/bnf-shadow-timeline?date='+encodeURIComponent(selected),
    {headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin',redirect:'error'});
   if(response.status===401){state.textContent='Admin key rejected. No private trade data released.';return;}
   if(!response.ok){state.textContent='Paper journal unavailable: HTTP '+response.status;return;}
   const report=await response.json();
   if(!report?.ok||report.mode!=='BNF_SHADOW_TIMELINE_READ_ONLY_V1'||report.brokerOrders!==0||
      report.actualBrokerFills!==false||!Array.isArray(report.trades)||!report.counts||
      report.date!==selected){state.textContent='Unexpected journal response; no trade details accepted.';return;}
   render(report);
   state.textContent='Loaded read-only historical PAPER receipts. No Telegram sent.';
  }catch{state.textContent='Unable to read private journal. No trade actions occurred.';}
  finally{go.disabled=false;}
 });
}
