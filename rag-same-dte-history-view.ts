/** Serialized, pure renderer. All source strings are escaped; no synthetic values. */
export function renderSameDteHistory(data:any){
 const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const numeric=(v:unknown)=>v!==null&&v!==undefined&&typeof v!=='boolean'&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const fmt=(v:unknown,d=2)=>numeric(v)===null?'ଅନୁପଲବ୍ଧ':Number(v).toFixed(d);
 const delta=(v:unknown)=>{const x=numeric(v);return x===null?'ଅନୁପଲବ୍ଧ':'<span class="'+(x>0?'rag-up':x<0?'rag-down':'rag-neutral')+'">'+(x>0?'↑ +':x<0?'↓ ':'↔ ')+fmt(x)+'</span>';};
 const a=data.anchor,matches=Array.isArray(data.matches)?data.matches:[];
 const row=(p:any,anchor=false)=>'<tr><td>'+esc(p.date)+(anchor?' · Selected':'')+'<br><small>expiry '+esc(p.expiry)+' · DTE '+esc(p.calendarDte)+'</small></td><td>'+esc(p.strike)+' '+esc(p.side)+'</td><td>₹'+fmt(p.before?.price)+' → ₹'+fmt(p.at?.price)+'<br>'+delta(p.premiumChange)+'</td><td>'+delta(p.spotChange)+'</td><td>'+(anchor?'Reference':fmt(p.moneynessDifferenceBps)+' bps')+'</td></tr>';
 const sources=[a,...matches].map(p=>'<p>'+esc(p.date)+' · '+esc(p.strike)+' '+esc(p.side)+'<br>Before: '+esc(p.before?.quoteAt)+' · receipt '+esc(p.before?.receiptAt)+' · snapshot '+esc(p.before?.snapshotId)+'<br>At: '+esc(p.at?.quoteAt)+' · receipt '+esc(p.at?.receiptAt)+' · snapshot '+esc(p.at?.snapshotId)+'<br>Model expiry close '+esc(p.clock?.closeIst)+' IST · '+esc(p.clock?.rule)+'</p>').join('');
 const failures=data.retrieval?.readFailures??[];
 return '<h3>Same-DTE history · '+esc(data.selectionSymbol??'')+' '+esc(a.side)+' · '+esc(a.at?.bucketAt?.slice(11,16)?new Date(Date.parse(a.at.bucketAt)+19800000).toISOString().slice(11,16):'—')+' IST</h3>'+
  '<p>'+esc(matches.length)+' prior day comparison · exact 3m recorded response</p>'+
  '<div class="rag-scroll"><table><thead><tr><th>Session / expiry</th><th>Contract</th><th>3m premium ₹</th><th>Spot Δ</th><th>Moneyness Δ</th></tr></thead><tbody>'+row(a,true)+matches.map((p:any)=>row(p)).join('')+'</tbody></table></div>'+
  (matches.length?'':'<p>ଏହି searched daysରେ verified same-DTE pair ମିଳିଲା ନାହିଁ।</p>')+
  '<details><summary>Context ଓ source details</summary><p>ସମାନ index, CE/PE, calendar DTE, IST minute ଓ expiry close clock। ପ୍ରତି ଦିନର closest recorded strike/spot moneyness ବାଛାଯାଇଛି; ଏହା similarity score ନୁହେଁ। IV/OI/PCR/wall context ଏଯାଏ match ହୋଇନାହିଁ।</p><p>Searched prior days: '+esc((data.retrieval?.requestedDays??[]).join(', '))+'<br>Cutoff: '+esc(data.cutoff)+'<br>Evidence SHA256: '+esc(data.provenance?.selectedEvidenceSha256)+'</p>'+
  (data.blocked??[]).map((b:any)=>'<p>'+esc(b.date)+' · '+esc(b.reason)+'</p>').join('')+
  (failures.length?'<p>Source read failed: '+esc(failures.join(', '))+'</p>':'')+sources+'</details>';
}
