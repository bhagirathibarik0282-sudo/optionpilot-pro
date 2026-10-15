import {parseRagQuestion} from './rag-question.js';
export const RAG_CARD_CSS=`
#rag-evidence-card{margin:12px 0;padding:14px;border:1px solid #9c8752;border-radius:12px;background:#0b1930;color:#edf3ff;font:17px/1.6 system-ui;min-width:0;max-width:100%;text-align:left}
#rag-evidence-card summary{color:#f4d889;font-weight:750;font-size:19px;cursor:pointer}#rag-evidence-card p{font:inherit;margin:10px 0;color:#cedbed}
#rag-evidence-card label{display:block;font-size:16px;color:#dce8f7;min-width:0}#rag-evidence-card :is(input,select,textarea,button){font:inherit;min-height:44px;max-width:100%;border:1px solid #5c7091;border-radius:7px;background:#13243d;color:#f4f7ff;padding:9px;box-sizing:border-box}
#rag-evidence-card :is(input,select,textarea){width:100%}#rag-evidence-card textarea{min-height:96px;resize:vertical}#rag-evidence-card button{cursor:pointer;margin:7px 7px 7px 0}#rag-evidence-card button[type=submit]{background:#f4d889;color:#071225;font-weight:700}#rag-evidence-card button:disabled{opacity:.6;cursor:wait}
#rag-evidence-card .rag-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#rag-evidence-card .rag-check{display:flex;align-items:center;gap:9px;margin:12px 0}#rag-evidence-card input[type=checkbox]{width:22px;min-height:22px}
#rag-evidence-card .rag-answer{padding:12px;background:#142a43;border-left:3px solid #f4d889;font-size:20px;color:#fff;white-space:pre-wrap;overflow-wrap:anywhere}
#rag-evidence-card .rag-scroll{overflow:auto}#rag-evidence-card table{width:100%;border-collapse:collapse;font-size:16px;white-space:nowrap}#rag-evidence-card :is(th,td){padding:10px;border-bottom:1px solid #3c506c;text-align:left;font-size:16px}#rag-evidence-card .rag-note{color:#b9cbe2;font-size:16px}#rag-status{white-space:pre-wrap;overflow-wrap:anywhere}#rag-evidence-card h3{font-size:19px;color:#f4d889}#rag-evidence-card details{margin-top:12px}#rag-evidence-card [hidden]{display:none!important}
@media(max-width:650px){#rag-evidence-card .rag-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#rag-evidence-card{padding:12px}#rag-evidence-card button{width:100%;margin-right:0}}`;
export const RAG_CARD_HTML=`<details id="rag-evidence-card" lang="or"><summary>RAG evidence · ପ୍ରଶ୍ନରୁ exact event ଖୋଜନ୍ତୁ</summary>
<p>ସଞ୍ଚିତ recorder dataରୁ PDH/PDL event ଓ recorded response। ଏହି selection dashboardର ଅନ୍ୟ chart selectionଠାରୁ ସ୍ୱତନ୍ତ୍ର।</p>
<label for="rag-question">ଆପଣଙ୍କ ପ୍ରଶ୍ନ<textarea id="rag-question" maxlength="800" placeholder="NIFTY 22300 PE date 2026-10-13 expiry 2026-10-13 time 09:36ରେ କଣ ହେଲା?"></textarea></label>
<button id="rag-extract" type="button">ପ୍ରଶ୍ନରୁ selection ଭରନ୍ତୁ</button><button id="rag-example" type="button">13 Octର ଯାଞ୍ଚ ହୋଇଥିବା ଉଦାହରଣ</button>
<p class="rag-note">NIFTY / SENSEX / BANKNIFTY, CE / PE, date / ତାରିଖ, expiry / ମିଆଦ, time / ସମୟ ଲେଖନ୍ତୁ। Date YYYY-MM-DD ବା DD/MM/YYYY। ତଳର fields ସିଧାସଳଖ ଭରି ମଧ୍ୟ ଖୋଜିପାରିବେ।</p>
<form id="rag-form"><div class="rag-grid"><label>Index<select id="rag-symbol" required><option value="">ବାଛନ୍ତୁ</option><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><label>Session date<input id="rag-date" type="date" required></label><label>Exact expiry<input id="rag-expiry" type="date" required></label><label>Strike<input id="rag-strike" type="number" min="1" max="1000000" step="1" required></label><label>Side<select id="rag-side" required><option value="">ବାଛନ୍ତୁ</option><option>CE</option><option>PE</option></select></label><label>Event time · IST<input id="rag-time" type="time" min="09:18" max="15:30" step="180" required></label><label>As-of cutoff · IST (optional)<input id="rag-asof" type="datetime-local" step="1"></label></div>
<label class="rag-check"><input id="rag-outcomes" type="checkbox">ପରବର୍ତ୍ତୀ +3/+6/+15/+30 ମିନିଟ୍ historical response ଦେଖାନ୍ତୁ</label>
<button id="rag-search" type="submit">Evidence ଖୋଜନ୍ତୁ</button><button id="rag-clear" type="button">Selection ସଫା କରନ୍ତୁ</button></form>
<p id="rag-status" role="status" aria-live="polite">ପ୍ରଶ୍ନରୁ selection ଭରି ଯାଞ୍ଚ କରନ୍ତୁ, ତାପରେ Evidence ଖୋଜନ୍ତୁ।</p><div id="rag-result"></div>
<p class="rag-note">ଏହା structured field extraction ଓ recorded evidence retrieval। Free-form semantic search ବା trading signal ନୁହେଁ। Missing data ଅନୁମାନରେ ଭରାଯାଏ ନାହିଁ।</p></details>`;

/** Serialized browser code: manual GET only, no timer, no broker/model call. */
export function installRagEvidenceCard(parseQuestion:typeof parseRagQuestion) {
  const $=(id:string)=>document.getElementById('rag-'+id) as HTMLInputElement;
  if(!$('form'))return;
  const keys=['symbol','date','expiry','strike','side','time'];
  const names:Record<string,string>={symbol:'Index',date:'Session date',expiry:'Expiry',strike:'Strike',side:'CE/PE',time:'Event time'};
  const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const n=(v:unknown,d=2)=>v!==null&&v!==undefined&&typeof v!=='boolean'&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v).toFixed(d):'ଅନୁପଲବ୍ଧ';
  let version=0,busy=false,active:AbortController|null=null;
  const clearResult=()=>{version++;active?.abort();$('result').innerHTML='';};
  const extract=()=>{
    clearResult();$('asof').value='';$('outcomes').checked=false;const p=parseQuestion($('question').value);
    for(const key of keys)$(key).value=p.fields[key]??'';
    $('status').textContent=p.issues.length?p.issues.join('\n'):'Selection ଯାଞ୍ଚ କରନ୍ତୁ।'+(p.missing.length?' ଆହୁରି ଦରକାର: '+p.missing.map(k=>names[k]).join(', '):' ସବୁ exact fields ଚିହ୍ନଟ ହୋଇଛି।');
  };
  $('extract').onclick=extract;
  $('example').onclick=()=>{$('question').value='NIFTY 22300 PE date 2026-10-13 expiry 2026-10-13 time 09:36';$('asof').value='';$('outcomes').checked=false;extract();};
  $('clear').onclick=()=>{($('form') as unknown as HTMLFormElement).reset();$('question').value='';clearResult();$('status').textContent='ନୂଆ exact selection ଭରନ୍ତୁ।';};
  $('form').addEventListener('input',()=>{clearResult();$('status').textContent='Selection ବଦଳିଛି। ପୁଣି Evidence ଖୋଜନ୍ତୁ।';});
  $('question').addEventListener('input',()=>{clearResult();for(const key of keys)$(key).value='';$('asof').value='';$('outcomes').checked=false;$('status').textContent='ନୂଆ ପ୍ରଶ୍ନ ପାଇଁ selection ପୁଣି ଭରନ୍ତୁ।';});
  const messages:Record<string,string>={EXACT_EVENT_PAIR_UNAVAILABLE_AT_CUTOFF:'ଏହି cutoff ସୁଦ୍ଧା exact event pair ଉପଲବ୍ଧ ନାହିଁ।',
    PREVIOUS_REFERENCE_UNAVAILABLE:'ଏହି contractର previous-session reference ଯାଞ୍ଚ ପାଇଁ ତଥ୍ୟ ଅନୁପଲବ୍ଧ।',PREVIOUS_REFERENCE_INCONSISTENT:'Previous-session reference ମେଳ ଖାଉନାହିଁ।',
    NO_RECONCILED_LEVEL_CROSSING:'ଚୟନ କରିଥିବା intervalରେ ଯାଞ୍ଚ ହୋଇଥିବା PDH/PDL crossing ମିଳିଲା ନାହିଁ।',EVENT_REQUIRES_REGULAR_3M_PAIR:'09:18ରୁ regular 3-minute event time ବାଛନ୍ତୁ, ଯଥା 09:36।',
    EVENT_AFTER_CUTOFF:'Event ସମୟ cutoff ପରେ ଅଛି।',REPLAY_SOURCE_UNAVAILABLE:'Recorded source ଏବେ ଉପଲବ୍ଧ ନାହିଁ।',EVIDENCE_SOURCE_UNAVAILABLE:'Recorded source ଏବେ ଉପଲବ୍ଧ ନାହିଁ।',
    INVALID_DATE_RANGE:'Session date ଯାଞ୍ଚ କରନ୍ତୁ।',INVALID_EXPIRY:'Expiry date ଯାଞ୍ଚ କରନ୍ତୁ।',INVALID_STRIKE:'ଠିକ୍ strike ଭରନ୍ତୁ।',INVALID_AS_OF:'Cutoff date/time ଯାଞ୍ଚ କରନ୍ତୁ।',UNSUPPORTED_OR_NONTRADING_DATE:'ଏହି date existing 2026 trading calendarରେ supported session ନୁହେଁ।'};
  $('form').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const missing=keys.filter(k=>!$(k).value);clearResult();if(missing.length){$('status').textContent='ଆହୁରି ଦରକାର: '+missing.map(k=>names[k]).join(', ');return;}
    const params=new URLSearchParams(Object.fromEntries(keys.map(k=>[k,$(k).value])));
    if($('outcomes').checked)params.set('includeOutcomes','true');if($('asof').value)params.set('asOf',$('asof').value);
    const mine=version;busy=true;($('search') as unknown as HTMLButtonElement).disabled=true;$('status').textContent='ଏହି exact selectionର recorder evidence ଖୋଜାଯାଉଛି…';
    const controller=new AbortController();active=controller;const timeout=setTimeout(()=>controller.abort(),45000);
    try {
      const response=await fetch('/api/research/rag-event-evidence?'+params.toString(),{cache:'no-store',signal:controller.signal});const data=await response.json();if(mine!==version)return;
      if(!response.ok||!data.ok){$('status').textContent=(messages[data.reason]??'Selection ଓ source availability ଯାଞ୍ଚ କରନ୍ତୁ।')+' ['+(data.reason??'HTTP '+response.status)+']';return;}
      const i=data.identity,r=data.reference;
      const table=(points:any[],future=false)=>'<div class="rag-scroll"><table><thead><tr><th>IST / offset</th><th>CE ₹</th><th>PE ₹</th><th>Spot</th><th>Full PCR</th><th>VIX</th><th>CE wall</th><th>PE wall</th></tr></thead><tbody>'+points.map((p,j)=>p?'<tr><td>'+esc(p.timeIst)+' / '+esc(p.offset>0?'+'+p.offset:p.offset)+'m</td><td>'+n(p.pair?.ce?.price)+'</td><td>'+n(p.pair?.pe?.price)+'</td><td>'+n(p.context?.spot)+'</td><td>'+n(p.context?.fullPcr,4)+'</td><td>'+n(p.context?.vix)+'</td><td>'+n(p.context?.ceWall,0)+'</td><td>'+n(p.context?.peWall,0)+'</td></tr>':'<tr><td>'+(future?'+'+[3,6,15,30][j]:[-30,-15,-6,-3,0][j])+'m</td><td colspan="7">ଅନୁପଲବ୍ଧ / cutoff ପରେ / session ବାହାରେ</td></tr>').join('')+'</tbody></table></div>';
      $('result').innerHTML='<h3>'+esc(i.symbol)+' '+esc(i.strike)+' '+esc(i.side)+' · expiry '+esc(i.expiry)+' · DTE '+esc(i.dte)+'</h3><p class="rag-answer">'+esc(data.answer)+'</p><p>Reference session '+esc(r.sourceDate)+' · PDH ₹'+n(r.pdh)+' · PDL ₹'+n(r.pdl)+'</p><h3>Event ପୂର୍ବରୁ → event ସମୟ</h3>'+table(data.beforeAndAt)+(data.outcomes.length?'<h3>ପରବର୍ତ୍ତୀ historical response</h3>'+table(data.outcomes,true):'<p>ପରବର୍ତ୍ତୀ outcome ଚାହିଁନାହାନ୍ତି।</p>')+
        '<details><summary>Source ଓ ସମୟ ଯାଞ୍ଚ</summary><p>As-of cutoff: '+esc(data.cutoff??'ନାହିଁ; retrospective readback')+'<br>Event available: '+esc(data.event.availableAt)+'<br>Selected evidence SHA256: '+esc(data.provenance.selectedEvidenceSha256)+'</p>'+data.beforeAndAt.filter(Boolean).map((p:any)=>'<p>'+esc(p.timeIst)+' IST · receipt '+esc(p.receiptAt)+'<br>CE quote '+esc(p.pair?.ce?.quoteAt)+' · PE quote '+esc(p.pair?.pe?.quoteAt)+'<br>Full PCR source '+esc(p.context?.fullPcrSource)+'</p>').join('')+'</details><p class="rag-note">Recorded context ଏକାଠି ଦେଖାଯାଇଛି; causality ବା seller profit ପ୍ରମାଣ ନୁହେଁ। Wall label ବଦଳିବା same-strike OI transferର ପ୍ରମାଣ ନୁହେଁ। Reference retrospective reconciliation; exchange freshness ଓ futures expiry continuity ଅଲଗା ଯାଞ୍ଚ ହୋଇନାହିଁ।</p>';
      $('status').textContent=i.date+'ର historical recorder readback · ଏହା current live quote ନୁହେଁ।';
    }catch{if(mine===version)$('status').textContent='Response ପଢ଼ିହେଲା ନାହିଁ। ପୁଣି Evidence ଖୋଜନ୍ତୁ।';}
    finally{clearTimeout(timeout);if(active===controller)active=null;busy=false;($('search') as unknown as HTMLButtonElement).disabled=false;}
  };
}
export const RAG_CARD_SCRIPT=`(()=>{const __name=(fn,_name)=>fn;(${installRagEvidenceCard.toString()})(${parseRagQuestion.toString()});})();`;
export function renderRagEvidencePage() {
  return `<!doctype html><html lang="or"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAG evidence · OptionPilot</title><style>body{margin:0;background:#071225;color:#eef4ff;font:18px system-ui}main{max-width:1200px;margin:auto;padding:16px}a{color:#f4d889}${RAG_CARD_CSS}</style></head><body><main><a href="/api/research/business-dashboard/view">← DATA dashboard</a>${RAG_CARD_HTML.replace('<details id="rag-evidence-card"','<details open id="rag-evidence-card"')}</main><script>${RAG_CARD_SCRIPT}</script></body></html>`;
}
