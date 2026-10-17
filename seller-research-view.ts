export const SELLER_RESEARCH_HTML=`<details id="seller-research-panel" class="panel"><summary>Seller · hedged pair research</summary><p>ଚୟନ କରିଥିବା pair ର Bid/Ask, margin ଓ risk · order execution ବନ୍ଦ</p><form id="seller-research-form"><div class="seller-controls"><label>Index<select id="sr-symbol"><option>NIFTY</option><option>SENSEX</option></select></label><label>Expiry<select id="sr-expiry"></select></label><label>Side<select id="sr-side"><option>CE</option><option>PE</option></select></label><label>Sell leg<select id="sr-short"></select></label><label>Buy hedge<select id="sr-long"></select></label><label>Quantity<input id="sr-quantity" type="number" min="1" step="1" required></label><label>Product<select id="sr-product"><option>NRML</option><option>MIS</option></select></label><label>Round-trip cost estimate ₹<input id="sr-costs" type="number" min="0" step="0.01" required placeholder="Your estimate"></label></div><button type="button" id="sr-load">Load live contracts</button> <button type="submit" id="sr-check">Check selected pair</button></form><div id="sr-result" role="status" aria-live="polite">No pair checked.</div><small>ସଂଖ୍ୟା ଯାଞ୍ଚ ସମୟର quote; stale ହେଲେ ଲୁଚିବ। Costs ଆପଣଙ୍କ estimate। ଏହା automatic candidate ବା fill guarantee ନୁହେଁ।</small></details>`;
export const SELLER_RESEARCH_CSS=`#seller-research-panel{margin-top:16px;padding:14px;border:1px solid #344b69;border-radius:12px;background:#0b1c33;font-size:17px}#seller-research-panel summary{cursor:pointer;font-size:20px;font-weight:650}#seller-research-panel small{display:block;color:#b7c9df;margin-top:12px}.seller-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.seller-controls label{display:flex;flex-direction:column;gap:5px}.seller-controls input,.seller-controls select{width:100%;box-sizing:border-box;min-height:44px;font-size:17px}#sr-result{margin-top:14px;overflow-wrap:anywhere}.seller-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.seller-metrics strong{display:block;font-size:25px;color:#66f1e2}.seller-blocked{color:#f3c577}`;

/** Self-contained browser installer, serialized by the existing dashboard view. */
export function installSellerResearch(){
 const panel=document.getElementById('seller-research-panel') as HTMLDetailsElement;if(!panel)return;
 const el=(id:string)=>document.getElementById(id) as HTMLInputElement;
 const result=el('sr-result'),form=el('seller-research-form') as unknown as HTMLFormElement;
 const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const fmt=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
 let rows:any[]=[],proof:any=null,busy=false,version=0;
 const messages:Record<string,string>={MARKET_CLOSED:'ବଜାର ବନ୍ଦ · live session ରେ ଯାଞ୍ଚ କରନ୍ତୁ',KITE_LOGIN_REQUIRED:'ପ୍ରଥମେ Kite login କରନ୍ତୁ',SELLER_DEPTH_STALE_OR_FUTURE:'ଦୁଇ leg ର fresh quote ଅପେକ୍ଷାରେ',SELLER_DEPTH_QUANTITY_INSUFFICIENT:'ଚୟନ କରିଥିବା quantity ପାଇଁ ଯଥେଷ୍ଟ Bid/Ask quantity ନାହିଁ',EXACT_TWO_LEG_DEPTH_MISSING:'ଦୁଇଟି contract ର ସମ୍ପୂର୍ଣ୍ଣ depth ମିଳିନାହିଁ',CAPITAL_INSUFFICIENT:'Margin/risk ପାଇଁ account capital ଯଥେଷ୍ଟ ନୁହେଁ',SELLER_CHECK_BUSY_OR_COOLDOWN:'ଯାଞ୍ଚ ଚାଲିଛି · କିଛି ସେକେଣ୍ଡ ପରେ ଚେଷ୍ଟା କରନ୍ତୁ'};
 const showBlocked=(reason:string)=>{proof=null;result.className='seller-blocked';result.textContent='BLOCKED · '+(messages[reason]||reason.replaceAll('_',' '));};
 const invalidate=()=>{version++;showBlocked('Pair/settings changed · check again');};
 const contracts=()=>rows.filter(x=>x.symbol===el('sr-symbol').value&&x.expiry===el('sr-expiry').value&&x.side===el('sr-side').value);
 const choices=(id:string,xs:any[])=>{const select=el(id),previous=select.value;select.innerHTML=xs.map(x=>'<option value="'+x.token+'">'+esc(x.strike+' · '+x.label)+'</option>').join('');if(xs.some(x=>String(x.token)===previous))select.value=previous;};
 const hedge=()=>{const s=contracts().find(x=>String(x.token)===el('sr-short').value);choices('sr-long',contracts().filter(x=>s&&(s.side==='CE'?x.strike>s.strike:x.strike<s.strike)));const q=el('sr-quantity');if(s?.lotSize){q.min=String(s.lotSize);q.step=String(s.lotSize);if(!q.value||Number(q.value)%s.lotSize!==0)q.value=String(s.lotSize);}};
 const legs=()=>{choices('sr-short',contracts());hedge();};
 const expiries=()=>{const select=el('sr-expiry'),previous=select.value,xs=[...new Set(rows.filter(x=>x.symbol===el('sr-symbol').value).map(x=>x.expiry))].sort();select.innerHTML=xs.map(x=>'<option>'+esc(x)+'</option>').join('');if(xs.includes(previous))select.value=previous;legs();};
 el('sr-symbol').onchange=()=>{invalidate();expiries();};el('sr-expiry').onchange=()=>{invalidate();legs();};el('sr-side').onchange=()=>{invalidate();legs();};el('sr-short').onchange=()=>{invalidate();hedge();};
 for(const id of ['sr-long','sr-quantity','sr-product','sr-costs'])el(id).oninput=invalidate;
 el('sr-load').onclick=async()=>{
  invalidate();try{const response=await fetch('/api/account/kite/seller/options',{cache:'no-store'}),body=await response.json();if(!response.ok){showBlocked((body.blockers||['Kite login required']).join(' · '));return;}rows=body.rows||[];expiries();showBlocked(rows.length?'Choose pair and enter a cost estimate':body.connectionState||'Live contracts unavailable');}catch{showBlocked('Contracts unavailable');}
 };
 const draw=()=>{
  if(!proof)return;if(Date.now()>=proof.deadline){showBlocked('Quote proof expired · check pair again');return;}
  const p=proof.data,e=p.card.economics;
  const metric=(label:string,value:unknown)=>'<div>'+esc(label)+'<strong>'+fmt(value)+'</strong></div>';
  result.className='';result.innerHTML='<b>PARTIAL · '+esc(p.source==='TEST_ONLY'?'TEST ONLY · ':'')+'research only</b><p>'+esc(p.pair.short.label)+' SELL + '+esc(p.pair.long.label)+' BUY · Qty '+p.pair.quantity+'</p><div class="seller-metrics">'+
   metric('Short Bid ₹',p.quotes.shortBid)+metric('Hedge Ask ₹',p.quotes.longAsk)+metric('Gross credit ₹',e.grossCredit)+metric('Net credit estimate ₹',e.estimatedNetCredit)+
   metric('Initial margin ₹',p.margin.initial)+metric('Final margin ₹',p.margin.final)+metric('Max loss estimate ₹',e.estimatedMaxLoss)+metric('Breakeven',e.breakeven)+
   '</div><p>Source · '+esc(new Date(p.asOfMs).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}))+' IST · valid for '+Math.max(0,Math.ceil((proof.deadline-Date.now())/1000))+'s</p>';
 };
 form.onsubmit=async(event)=>{
  event.preventDefault();if(busy)return;const request={symbol:el('sr-symbol').value,shortToken:Number(el('sr-short').value),longToken:Number(el('sr-long').value),quantity:Number(el('sr-quantity').value),product:el('sr-product').value,estimatedRoundTripCosts:Number(el('sr-costs').value)};
  if(!el('sr-costs').value||!request.shortToken||!request.longToken){showBlocked('Choose both contracts and enter cost estimate');return;}
  invalidate();const attempt=version,started=Date.now();busy=true;(el('sr-check') as unknown as HTMLButtonElement).disabled=true;result.textContent='Checking live pair…';
  try{const response=await fetch('/api/account/kite/seller/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),cache:'no-store',signal:AbortSignal.timeout(30000)}),body=await response.json();if(attempt!==version)return;
   if(!response.ok||body.status!=='PARTIAL'||!body.card?.economics){showBlocked((body.blockers||['Evidence unavailable']).join(' · '));return;}
   // Subtract the full request duration: browser clock skew cannot prolong proof validity.
   const remaining=Math.max(0,body.validUntilMs-body.asOfMs-(Date.now()-started));proof={data:body,deadline:Date.now()+remaining};draw();
  }catch{if(attempt===version)showBlocked('Live check unavailable');}finally{busy=false;(el('sr-check') as unknown as HTMLButtonElement).disabled=false;}
 };
 setInterval(()=>{if(proof)draw();},250);
 window.addEventListener('optionpilot:live-context',((event:any)=>{if(!event.detail?.connected){version++;if(proof||busy)showBlocked('Live feed disconnected');}}) as EventListener);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){version++;showBlocked('Refresh proof after returning');}});
}
