import {BNF_SHADOW_DAYWISE_HTML,BNF_SHADOW_DAYWISE_CSS,installBnfShadowDaywise} from './bnf-shadow-daywise-view.js';
import {BNF_SHADOW_TIMELINE_HTML,BNF_SHADOW_TIMELINE_CSS,installBnfShadowTimeline} from './bnf-shadow-trade-timeline-view-v1.js';
import {BNF_HISTORY_PANEL_HTML,BNF_HISTORY_PANEL_CSS,deriveBnfHistoricalReview,attachBnfHistoricalSourceAudit,installBnfHistoricalPanel} from './bnf-historical-evidence-panel-v1.js';

/** A lightweight dedicated viewer; never starts a market stream, worker or order. */
export function installBnfShadowPage(){
 const status=document.getElementById('bnf-page-worker'),refresh=document.getElementById('bnf-page-refresh');
 if(!status||!refresh)return;
 let busy=false;
 const load=async()=>{
  if(busy)return;busy=true;
  try{
   const runtime=await fetch('/ops/runtime-status',{cache:'no-store',credentials:'same-origin'});
   if(runtime.ok&&(await runtime.json()).shouldRun===false){status.textContent='OFF HOURS · saved journal and replay evidence remain available below.';return;}
   const response=await fetch('/api/research/dashboard-live/bnf-shadow',{cache:'no-store',credentials:'same-origin'});
   if(!response.ok)throw Error();const data=await response.json();
   if(data.mode!=='SHADOW')throw Error();
   const n=(v:any)=>Number.isSafeInteger(v)&&v>=0?String(v):'unverified';
   status.textContent=(data.workerRunning&&data.feedConnected&&data.phase==='READY'?'READY · feed OPEN':'NOT READY · '+String(data.phase||'UNKNOWN'))+
    ' · '+n(data.lots)+' lots · current-run signals '+n(data.sourceCounts?.signals)+
    ' · replay '+String(data.replayCapture?.state||'unverified')+' · records '+n(data.replayCapture?.recordsWritten)+
    ' · dropped '+n(data.replayCapture?.recordsDropped)+'. Broker orders: 0.';
  }catch{status.textContent='Live worker status unavailable. Saved journal evidence below is separate.';}
  finally{busy=false;}
 };
 refresh.addEventListener('click',()=>void load());void load();
}

export function renderBnfShadowPage(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BANKNIFTY SHADOW · OptionPilot</title><style>
*{box-sizing:border-box}body{margin:0;background:#071321;color:#e6f3ff;font:15px/1.5 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:14px;min-width:0}header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}h1{font-size:23px;margin:8px 0;color:#71efdd}a{color:#74e9dd}a,button,input{min-height:42px}button,input{font:inherit;padding:8px;border:1px solid #426077;border-radius:7px;background:#12263b;color:#edf8ff}button{cursor:pointer}label{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}.note,.worker{padding:12px;border:1px solid #3e5d72;border-radius:9px;background:#102336;margin:12px 0}.note p{margin:5px 0}.muted{color:#b9cddd}.worker p{margin:0 0 8px;overflow-wrap:anywhere}
${BNF_SHADOW_DAYWISE_CSS}${BNF_SHADOW_TIMELINE_CSS}${BNF_HISTORY_PANEL_CSS}
.op-bnf-daywise{padding:12px}.op-bnf-daywise summary{font-size:17px}.op-bnf-daywise p,.op-bnf-daywise small{font-size:13px}.op-bnf-daywise label{margin:10px 0}.op-bnf-daywise table{font-size:14px}
</style></head><body><main><header><h1>BANKNIFTY · SHADOW PAPER</h1><a href="/api/research/business-dashboard/view">← Market dashboard</a></header>
<section class="note" aria-label="Meaning of estimated paper profit"><strong>What does “est” mean?</strong><p><b>est = estimated.</b> These are paper simulation results. A positive number is estimated paper profit; a negative number is estimated paper loss.</p><p>Estimated realized paper P&amp;L = simulated exit proceeds − simulated entry cost − the recorded cost reserve. It is not money earned or lost in your broker account.</p><p class="muted">ଆନୁମାନିକ paper result—real broker ଲାଭ କିମ୍ବା କ୍ଷତି ନୁହେଁ।</p></section>
<section class="worker" aria-label="Current worker status"><p id="bnf-page-worker" role="status">Checking worker…</p><button id="bnf-page-refresh" type="button">Refresh worker status</button></section>
${BNF_SHADOW_DAYWISE_HTML}${BNF_SHADOW_TIMELINE_HTML}${BNF_HISTORY_PANEL_HTML}
</main><script>const __name=(fn,_name)=>fn;(${installBnfShadowPage.toString()})();(${installBnfShadowDaywise.toString()})();const deriveBnfHistoricalReview=${deriveBnfHistoricalReview.toString()};const attachBnfHistoricalSourceAudit=${attachBnfHistoricalSourceAudit.toString()};(${installBnfHistoricalPanel.toString()})();(${installBnfShadowTimeline.toString()})();</script></body></html>`;}
