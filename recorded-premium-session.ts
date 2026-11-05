/** Full-session recorded premium view. Sampled LTP is never promoted to OHLC. */
export function renderRecordedPremiumSession(input:any):string {
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const num=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const fmt=(v:any)=>num(v)===null?'—':v.toLocaleString('en-IN',{maximumFractionDigits:2});
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
 const clock=(v:number)=>new Date(v+19800000).toISOString().slice(11,16);
 const date=String(input.date||''),symbol=String(input.symbol||''),strike=num(input.strike),cursor=stamp(input.cursor);
 const start=Date.parse(date+'T09:15:00+05:30'),end=Date.parse(date+'T'+String(input.sessionEnd||'15:30')+':00+05:30');
 if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(cursor)||strike===null)return '<p>Choose a recorded date, exact strike and replay time.</p>';
 const cutoff=Math.min(cursor,end),cadence=Number(input.cadenceMinutes)===3?3:1;
 const interval=[1,3,5,15,30,60].includes(Number(input.interval))?Number(input.interval):1;
 const rows=(input.options||[]).filter((r:any)=>r.symbol===symbol&&num(r.strike)===strike&&['CE','PE'].includes(r.option_type));
 // Session inventory is identity metadata; never use future prices/levels for rendering.
 const expiries=[...new Set<string>((input.options||[]).filter((r:any)=>r.symbol===symbol).map((r:any)=>String(r.expiry).slice(0,10)).filter((v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)))].sort();
 if(input.scope==='SELECTED'&&!expiries.includes(input.expiry))expiries.push(input.expiry);
 const shown=input.scope==='SELECTED'?[input.expiry]:expiries;
 const markets=new Map<number,any[]>();
 for(const m of input.market||[]){const t=stamp(m.minute_bucket);if(m.symbol!==symbol||t<start||t>cutoff||!Number.isFinite(t))continue;if(!markets.has(t))markets.set(t,[]);markets.get(t)!.push(m);}
 const lookup=new Map<string,any[]>();
 for(const r of rows){const t=stamp(r.minute_bucket);if(!Number.isFinite(t)||t<start||t>cutoff)continue;const key=String(r.expiry).slice(0,10)+'|'+r.option_type+'|'+t;if(!lookup.has(key))lookup.set(key,[]);lookup.get(key)!.push(r);}
 const valid=(r:any,t:number)=>{
  const ms=markets.get(t)||[];if(ms.length!==1)return false;const m=ms[0],quote=stamp(r.quote_timestamp),receipt=stamp(m.backend_timestamp);
  return r.truth_verdict==='TRUE'&&m.truth_verdict==='TRUE'&&!!m.snapshot_id&&m.snapshot_id===r.snapshot_id&&
   num(r.ltp)!==null&&r.ltp>0&&Number.isFinite(quote)&&Number.isFinite(receipt)&&
   new Date(quote+19800000).toISOString().slice(0,10)===date&&(receipt-quote)>=-5000&&(receipt-quote)<=30000;
 };
 let html='<p>09:15–'+esc(clock(end))+' IST · fixed strike '+fmt(strike)+' · '+interval+'m sampled line · source cadence '+cadence+'m (no interpolation) · values stop at replay cursor '+esc(clock(cursor))+'. Only archived ATM ±7 contracts. OHLC unavailable in this source; no candles reconstructed. O=H unavailable without an independently saved session open.</p>';
 if(!shown.length)return html+'<p>No saved expiries for this strike.</p>';
 for(const expiry of shown){
  const dte=(Date.parse(expiry+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000;
  html+='<article><h3>'+esc(expiry)+' · DTE '+(Number.isFinite(dte)?dte:'—')+' · '+fmt(strike)+'</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:10px">';
  for(const side of ['CE','PE']){
   const samples:any[]=[];
   for(let t=start;t<=cutoff;t+=cadence*60000){
    const rs=lookup.get(expiry+'|'+side+'|'+t)||[],unique=new Map(rs.map(r=>[JSON.stringify([r.ltp,r.snapshot_id,r.quote_timestamp,r.truth_verdict,r.pdh,r.pdl]),r]));
    const r=unique.size===1?[...unique.values()][0]:null;
    samples.push({at:t,row:r&&valid(r,t)?r:null});
   }
   const eligible=samples.filter(p=>p.row),last=eligible.at(-1)?.row;
   const groups=new Map<number,any[]>();for(const p of samples){const bucket=Math.floor((p.at-start)/(interval*60000));if(!groups.has(bucket))groups.set(bucket,[]);groups.get(bucket)!.push(p);}
   // Preserve the actual timestamp of the last sample in a display bucket. Any
   // missing source observation breaks connections on either side of the bucket.
   const points=[...groups.values()].map(group=>({at:group.at(-1).at,row:group.at(-1).row,complete:group.every(p=>!!p.row)}));
   const values=eligible.map(p=>p.row.ltp),levels=[['PDH',num(last?.pdh),'#08723b'],['PDL',num(last?.pdl),'#b62135']] as const;
   const bounds=[...values,...levels.map(l=>l[1]).filter((v:any)=>v!==null)];
   const label=esc(side+' '+symbol+' '+expiry+' '+strike+' sampled premium 09:15 to EOD');
   html+='<section><h4>'+side+' · '+eligible.length+' / '+samples.length+' eligible samples through cursor</h4>';
   if(!values.length){html+='<p>No eligible saved quotes at or before cursor. Missing stays missing.</p></section>';continue;}
   const lo=Math.min(...bounds),hi=Math.max(...bounds),pad=Math.max((hi-lo)*.06,1),y=(v:number)=>160-(v-lo+pad)/(hi-lo+2*pad)*135,x=(t:number)=>58+(t-start)/Math.max(60000,end-start)*510;
   let marks='',prev:any=null;
   for(const p of points){if(!p.row){prev=null;continue;}const color=side==='CE'?'#08723b':'#b62135';
    if(prev&&prev.complete&&p.complete)marks+='<path data-premium-segment="true" d="M '+x(prev.at)+' '+y(prev.row.ltp)+' L '+x(p.at)+' '+y(p.row.ltp)+'" fill="none" stroke="'+color+'" stroke-width="2"/>';
    marks+='<circle cx="'+x(p.at)+'" cy="'+y(p.row.ltp)+'" r="3" fill="'+color+'"><title>'+esc(clock(p.at)+' IST · ₹'+fmt(p.row.ltp)+' · quote '+p.row.quote_timestamp)+'</title></circle>';prev=p;
   }
   const guides=levels.filter(l=>l[1]!==null).map(([name,v,color])=>'<line x1="58" x2="568" y1="'+y(v!)+'" y2="'+y(v!)+'" stroke="'+color+'" stroke-dasharray="5 4"/><text x="60" y="'+(y(v!)-3)+'" fill="'+color+'">'+name+' '+fmt(v)+'</text>').join('');
   const ticks=[start,start+90*60000,start+180*60000,start+270*60000,end].filter(t=>t<=end).map(t=>'<text x="'+x(t)+'" y="192" text-anchor="middle">'+clock(t)+'</text>').join('');
   html+='<svg viewBox="0 0 600 205" style="width:100%;height:auto;min-height:145px" role="img" aria-label="'+label+'"><g font-size="10" fill="currentColor">'+guides+marks+'<text x="2" y="20">'+fmt(hi)+'</text><text x="2" y="160">'+fmt(lo)+'</text>'+ticks+'<line x1="'+x(cutoff)+'" x2="'+x(cutoff)+'" y1="15" y2="165" stroke="#66776c" stroke-dasharray="2 3"/></g></svg>';
   const recent=eligible.filter(p=>p.at>cutoff-15*60000),recentHigh=recent.length?Math.max(...recent.map(p=>p.row.ltp)):null,recentLow=recent.length?Math.min(...recent.map(p=>p.row.ltp)):null;
   html+='<p>PDH '+fmt(last?.pdh)+' · PDL '+fmt(last?.pdl)+' · trailing 15m sampled H/L '+fmt(recentHigh)+' / '+fmt(recentLow)+' ('+recent.length+' samples). Missing/excluded '+(samples.length-eligible.length)+'. Lines break at source gaps.</p>';
   html+='<details><summary>All '+eligible.length+' eligible premium observations · source times</summary><div style="max-height:260px;overflow:auto"><table><thead><tr><th>IST</th><th>LTP ₹</th><th>PDH</th><th>PDL</th><th>Quote time</th></tr></thead><tbody>'+eligible.map(p=>'<tr><td>'+clock(p.at)+'</td><td>'+fmt(p.row.ltp)+'</td><td>'+fmt(p.row.pdh)+'</td><td>'+fmt(p.row.pdl)+'</td><td>'+esc(p.row.quote_timestamp)+'</td></tr>').join('')+'</tbody></table></div></details></section>';
  }
  html+='</div></article>';
 }
 return html;
}
