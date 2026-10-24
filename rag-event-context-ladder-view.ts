import type {buildEventContextLadder,ContextFamily,ContextCell} from './rag-event-context-ladder.js';

type LadderResult=ReturnType<typeof buildEventContextLadder>;
const FAMILIES:readonly ContextFamily[]=['SPOT','FUTURES','PREMIUM','PCR_OI','HEAVYWEIGHT','SECTOR','FII_DII'];
const TITLES:Record<ContextFamily,string>={
 SPOT:'Spot • PDH/PDL/PDC',FUTURES:'Futures • OI / basis',PREMIUM:'CE/PE • exact contract',
 PCR_OI:'Full PCR • scoped recorded evidence',HEAVYWEIGHT:'Heavyweights • verified weights',
 SECTOR:'Sectors • verified weights',FII_DII:'FII/DII • last published daily context'
};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const value=(v:number|null)=>v===null?'—':Number.isFinite(v)?new Intl.NumberFormat('en-IN',{maximumFractionDigits:4}).format(v):'—';
const signed=(v:number|null,suffix='')=>v===null?'—':(v>0?'▲ ':v<0?'▼ ':'→ ')+(v>0?'+':'')+value(v)+suffix;
function levelClass(metric:string):string{
 const s=metric.toUpperCase();
 if(s==='PDH'||s.endsWith('_PDH'))return 'rcl-pdh';
 if(s==='PDL'||s.endsWith('_PDL'))return 'rcl-pdl';
 if(s==='PDC'||s.endsWith('_PDC'))return 'rcl-pdc';
 return '';
}
function row(c:ContextCell,phase:string,time:string):string{
 const trend=c.changePct===null?'':c.changePct>0?'rcl-up':c.changePct<0?'rcl-down':'rcl-flat';
 return '<tr><td>'+esc(phase)+' · '+esc(time)+'</td><td>'+esc(c.entity)+'</td><td class="'+levelClass(c.metric)+'">'+esc(c.metric)+'</td>'+
  '<td class="rcl-number">'+value(c.value)+'</td><td class="'+trend+'">'+signed(c.changePct,'%')+'</td>'+
  '<td>'+value(c.weightPct)+'</td><td>'+value(c.contribution)+'</td>'+
  '<td><time>'+esc(c.sourceAt)+'</time><small>'+esc(c.provenance)+'</small></td></tr>';
}
export const EVENT_CONTEXT_LADDER_CSS=`#event-context-ladder{max-width:100%}.rcl-card{background:#0b1524;color:#f0f7ff;border:1px solid #33546b;border-radius:12px;padding:10px;font:14px/1.5 system-ui}.rcl-card h3{margin:0 0 6px;font-size:18px}.rcl-meta{color:#caedff;font-weight:600;overflow-wrap:anywhere}.rcl-note,.rcl-unavailable{color:#b8c9d8;font-size:12px}.rcl-card details{border-top:1px solid #284157;padding:8px 0}.rcl-card summary{cursor:pointer;min-height:40px;color:#81daf7;font-weight:650}.rcl-card summary span{float:right;color:#b8c9d8;font-weight:400}.rcl-scroll{overflow-x:auto;max-width:100%}.rcl-card table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:12px}.rcl-card th,.rcl-card td{padding:6px 7px;border-bottom:1px solid #284157;white-space:nowrap;text-align:left}.rcl-card td:last-child{white-space:normal;min-width:150px;overflow-wrap:anywhere}.rcl-card td small{display:block;color:#a9bed0;font-size:10px}.rcl-number{font-weight:650}.rcl-up,.rcl-pdl{color:#3fe099}.rcl-down,.rcl-pdh{color:#ff6d78}.rcl-flat,.rcl-pdc{color:#ffd34d}@media(max-width:500px){.rcl-card{padding:8px}.rcl-card th,.rcl-card td{padding:6px 5px}}@media(prefers-reduced-motion:reduce){.rcl-card *{animation:none!important}}`;
export function renderEventContextLadder(result:LadderResult):string{
 if(!result.ok) return '<section class="rcl-card"><h3>Recorder → Event Context</h3><p role="status">Evidence unavailable · '+esc(result.reason)+'</p></section>';
 const isSnapshot=result.event.kind==='PREMIUM_SNAPSHOT';
 const sourceRows=result.lanes.flatMap(l=>l.cells.map(c=>({phase:l.phase==='BEFORE'?'Before '+l.offsetMinutes+'m':l.phase==='EVENT'?(isSnapshot?'Selected snapshot':'Event'):'After +'+l.offsetMinutes+'m',order:l.offsetMinutes,time:l.timeIst,c})));
 const head='<thead><tr><th>IST</th><th>Entity</th><th>Parameter</th><th>Value</th><th>Δ%</th><th>Weight%</th><th>Contribution</th><th>Source time / evidence</th></tr></thead>';
 const sections=FAMILIES.map(f=>{
   const arr=f==='FII_DII'?result.institutionalContext.map(c=>({phase:'Published '+c.sessionDate,order:0,time:c.publishedAt,c})):
     sourceRows.filter(x=>x.c.family===f);
   const items=arr.sort((a,b)=>a.order-b.order||((b.c.weightPct??-1)-(a.c.weightPct??-1))||a.c.entity.localeCompare(b.c.entity)||a.c.metric.localeCompare(b.c.metric));
   const contents=items.length?'<div class="rcl-scroll"><table>'+head+'<tbody>'+
    items.map(x=>row(x.c,x.phase,x.time)).join('')+'</tbody></table></div>':
    '<p class="rcl-unavailable">No verified recorded observations for this event and family. Not neutral or zero.</p>';
   return '<details'+(['SPOT','PREMIUM','PCR_OI'].includes(f)?' open':'')+'><summary>'+esc(TITLES[f])+' <span>'+items.length+' rows</span></summary>'+contents+'</details>';
 }).join('');
 const id=result.event;
 return '<section class="rcl-card" aria-label="Single-snapshot historical research ladder"><h3>Recorder → '+(isSnapshot?'Selected snapshot evidence':'Event-wise RAG evidence')+'</h3>'+
   '<p class="rcl-meta">'+esc(id.date)+' · '+esc(id.index)+' · '+esc(id.timeIst)+' IST · '+esc(id.kind)+
   (id.expiry?' · expiry '+esc(id.expiry):'')+(id.strike?' · '+value(id.strike)+' '+esc(id.side??''):'')+'</p>'+
   '<p class="rcl-note">'+(isSnapshot?'This is a selected recorded snapshot, NOT a detected PDH/PDL, OI wall or PCR event. Similar-event retrieval is NOT performed. ':'')+'Each family is separate. Before/selected measurements are bounded by eventKnownAt; After is retrospective outcome only. Arrow shows recorded change, not trade direction.</p>'+
   sections+'<details><summary>Audit and source limitations</summary><p>Accepted '+result.coverage.accepted+
   ' · Rejected '+result.coverage.rejected+' · Conflicts '+result.coverage.conflicts+
   ' · FII/DII publications '+result.coverage.institutional+'</p>'+
   '<p>'+result.limitations.map(esc).join(' ')+'</p>'+
   (result.blocked.length?'<p>Blocked: '+result.blocked.map(esc).join('; ')+'</p>':'')+'</details></section>';
}
