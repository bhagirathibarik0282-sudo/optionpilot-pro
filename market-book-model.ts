/** Read-only book over existing TRUE recordings. No candidate, broker or persistence authority. */
export function deriveMarketBook(input: any) {
 const num=(v:any):number|null=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
 const date=(t:any)=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+19800000).toISOString().slice(0,10):'';
 const minute=(t:any)=>{const d=new Date(Date.parse(t)+19800000);return d.getUTCHours()*60+d.getUTCMinutes();};
 const id=(r:any)=>[r.symbol,String(r.expiry).slice(0,10),r.strike,r.option_type].join('|');
 const sorted=(rs:any[])=>[...new Map((rs||[]).filter(r=>r.truth_verdict==='TRUE'&&Number.isFinite(Date.parse(r.minute_bucket))).map(r=>[r.minute_bucket+'|'+(r.expiry||'')+'|'+(r.strike||'')+'|'+(r.option_type||''),r])).values()].sort((a:any,b:any)=>Date.parse(a.minute_bucket)-Date.parse(b.minute_bucket));
 const pct=(a:any,b:any)=>num(a)===null||num(b)===null||Number(b)===0?null:(Number(a)/Number(b)-1)*100;
 const delta=(a:any,b:any)=>num(a)===null||num(b)===null?null:Number(a)-Number(b);
 const current=input.current||{},history=input.history||[],symbol=input.symbol||'NIFTY',tradeDate=input.tradeDate||'',window=input.window||'3m',minutes=/^\d+m$/.test(window)?Number(window.slice(0,-1)):null,sessions=/^\d+s$/.test(window)?Number(window.slice(0,-1)):null;
 const dates=[...new Set<string>((input.recordedDates||[]).filter((d:string)=>d<tradeDate))].sort();
 const priorDate=dates.at(-1)||null,baselineDate=sessions?dates.at(-sessions)||null:null;
 const currentRows=(kind:string)=>sorted(current[kind]||[]).filter(r=>r.symbol===symbol&&date(r.minute_bucket)===tradeDate);
 const historyCache=new Map<string,any[]>();
 const historyRows=(kind:string)=>{if(!historyCache.has(kind))historyCache.set(kind,sorted(history.flatMap((d:any)=>d[kind]||[])).filter(r=>r.symbol===symbol&&date(r.minute_bucket)<tradeDate));return historyCache.get(kind)!;};
 const previousRows=(kind:string)=>historyRows(kind).filter(r=>date(r.minute_bucket)===priorDate);
 const baselineMaps=new Map<string,Map<string,any>>();
 const baselineEndpoint=(kind:string,identity:string)=>{if(!baselineMaps.has(kind)){const map=new Map<string,any>();historyRows(kind).filter(r=>date(r.minute_bucket)===baselineDate).forEach(r=>map.set(kind==='options'?id(r):r.symbol,r));baselineMaps.set(kind,map);}return baselineMaps.get(kind)!.get(identity||symbol);};
 const metrics=(rs:any[],field:string,kind:string,identity='')=>{
  const rows=sorted(rs),last=rows.at(-1),time=last?.minute_bucket||null;
  const old=minutes&&time?rows.find(r=>Date.parse(r.minute_bucket)===Date.parse(time)-minutes*60000):sessions&&baselineDate?baselineEndpoint(kind,identity):null;
  return {value:num(last?.[field]),at:time,from:num(old?.[field]),fromAt:old?.minute_bucket||null,delta:delta(last?.[field],old?.[field]),percent:pct(last?.[field],old?.[field]),reason:!old?'Exact baseline unavailable':sessions?'Last recorded endpoint; not official close':'Exact recorded endpoints'};
 };
 const pivots=(h:any,l:any,c:any,at:any)=>{if(num(h)===null||num(l)===null||num(c)===null||h<l||!at||minute(at)!==930)return null;const p=(Number(h)+Number(l)+Number(c))/3,w=Number(h)-Number(l);return {R3:p+w,R2:p+.618*w,R1:p+.382*w,P:p,S1:p-.382*w,S2:p-.618*w,S3:p-w,at,semantics:'Previous stored session high/low + sampled 15:30 endpoint'};};
 const range=(rs:any[],field:string)=>{
  const rows=sorted(rs),opening=rows.filter(r=>minute(r.minute_bucket)>=555&&minute(r.minute_bucket)<570&&num(r[field])!==null),last=rows.at(-1);
  const complete=!!last&&minute(last.minute_bucket)>=570&&opening.length>=5&&opening.some(r=>minute(r.minute_bucket)===555)&&opening.some(r=>minute(r.minute_bucket)>=567);
  const high=complete?Math.max(...opening.map(r=>Number(r[field]))):null,low=complete?Math.min(...opening.map(r=>Number(r[field]))):null,events:any[]=[];
  if(complete)rows.forEach((r,i)=>{const p=rows[i-1];if(!p||minute(r.minute_bucket)<570||Date.parse(r.minute_bucket)-Date.parse(p.minute_bucket)>180000||num(p[field])===null||num(r[field])===null)return;if(p[field]<=high!&&r[field]>high!)events.push({direction:'UP',level:high,from:p.minute_bucket,at:r.minute_bucket});if(p[field]>=low!&&r[field]<low!)events.push({direction:'DOWN',level:low,from:p.minute_bucket,at:r.minute_bucket});});
  return {high,low,samples:opening.length,complete,events,state:!complete?'Opening sampled range unavailable':num(last?.[field])===null?'Current value unavailable':last[field]>high!?'Above 15m sampled high':last[field]<low!?'Below 15m sampled low':'Inside 15m sampled range',semantics:'09:15–09:30 sampled LTP range, not exchange candle extremes'};
 };

 const points=(rows:any[],kind:string,field:string,identity='')=>{const rs=sessions?historyRows(kind).filter(r=>date(r.minute_bucket)>=String(baselineDate||tradeDate)&&(!identity||id(r)===identity)).concat(rows):rows;if(!sessions)return rs.map(r=>({at:r.minute_bucket,value:num(r[field])}));const days=new Map<string,any>();rs.forEach(r=>days.set(date(r.minute_bucket),r));return [...days.values()].map(r=>({at:r.minute_bucket,value:num(r[field])}));};
 const market=currentRows('market'),m=market.at(-1),pm=previousRows('market').at(-1),options=currentRows('options');
 const spot={...metrics(market,'spot_ltp','market'),pdh:num(m?.pdh),pdl:num(m?.pdl),pivot:pivots(pm?.spot_high,pm?.spot_low,pm?.spot_ltp,pm?.minute_bucket),range:range(market,'spot_ltp'),points:points(market,'market','spot_ltp'),prior:{value:num(pm?.spot_ltp),at:pm?.minute_bucket||null}};
 const futureMetric=metrics(market,'future_ltp','market');
 const future={...futureMetric,...(sessions?{from:null,fromAt:null,delta:null,percent:null,reason:'Historical futures contract identity unavailable; swing comparison excluded'}:{}),pdh:null,pdl:null,pivot:null,range:range(market,'future_ltp'),points:market.map(r=>({at:r.minute_bucket,value:num(r.future_ltp)})),oi:metrics(market,'future_oi','market'),basis:num(m?.future_basis),identity:'Futures series; expiry continuity unverified',prior:{value:null,at:null}};
 if(sessions)future.oi={...future.oi,from:null,fromAt:null,delta:null,percent:null,reason:'Futures contract identity unavailable'};
 const buckets=[...new Set(options.map(r=>String(r.expiry).slice(0,10)))].sort();
 const expiry=input.expiry&&buckets.includes(input.expiry)?input.expiry:buckets[0]||'',oppositeExpiry=input.oppositeExpiry&&buckets.includes(input.oppositeExpiry)?input.oppositeExpiry:expiry;
 const strikes=[...new Set(options.filter(r=>String(r.expiry).slice(0,10)===expiry).map(r=>Number(r.strike)))].sort((a,b)=>a-b);
 const strike=strikes.includes(Number(input.strike))?Number(input.strike):strikes.reduce((best,k)=>Math.abs(k-(num(m?.spot_ltp)??k))<Math.abs(best-(num(m?.spot_ltp)??best))?k:best,strikes[0]);
 const optionGroups=new Map<string,any[]>(),priorGroups=new Map<string,any>(),premiumCache=new Map<string,any>();
 options.forEach(r=>{const k=id(r);if(!optionGroups.has(k))optionGroups.set(k,[]);optionGroups.get(k)!.push(r);});previousRows('options').forEach(r=>priorGroups.set(id(r),r));
 function premium(expiry:string,strike:number,type:string){
  const identity=[symbol,expiry,strike,type].join('|');if(premiumCache.has(identity))return premiumCache.get(identity);
  const rows=optionGroups.get(identity)||[],last=rows.at(-1),prior=priorGroups.get(identity),metric=metrics(rows,'ltp','options',identity),under=last?market.find(r=>r.minute_bucket===last.minute_bucket):null;
  const intrinsic=under&&num(under.spot_ltp)!==null&&Number.isFinite(strike)?Math.max(type==='CE'?under.spot_ltp-strike:strike-under.spot_ltp,0):null;
  const extrinsic=intrinsic!==null&&num(last?.ltp)!==null?Number(last.ltp)-intrinsic:null;
  const mismatch=extrinsic!==null&&extrinsic<0;
  const result={...metric,symbol,expiry,strike,type,identity,dte:num(last?.dte),expiryBucket:last?.expiry_bucket||'Unavailable',intrinsic:mismatch?null:intrinsic,extrinsic:mismatch?null:extrinsic,decompositionReason:mismatch?'Premium below same-time intrinsic value; decomposition withheld':!under?'Exact same-time underlying missing':'Calculated from exact same-time recorded spot',impliedIv:num(last?.iv),oi:metrics(rows,'oi','options',identity),pdh:num(last?.pdh),pdl:num(last?.pdl),pivot:pivots(prior?.day_high,prior?.day_low,prior?.ltp,prior?.minute_bucket),range:range(rows,'ltp'),open:null,openHigh:'Unavailable: option session Open not exposed by source',points:points(rows,'options','ltp',identity),prior:{value:num(prior?.ltp),at:prior?.minute_bucket||null},source:last?.validation_status||'Unavailable'};premiumCache.set(identity,result);return result;
 }
 const ce=premium(expiry,strike,'CE'),pe=premium(oppositeExpiry,strike,'PE');
 const qualifiedChain=(rs:any[])=>rs.map(r=>({...r,full_chain_oi_pcr:/^(Exact archived full-chain source|Normalized full-chain source)$/.test(r.full_pcr_source||'')?r.full_chain_oi_pcr:null}));
 const chain=qualifiedChain(currentRows('chain')).filter(r=>String(r.expiry).slice(0,10)===expiry),c=chain.at(-1),oldChain=minutes&&c?chain.find(r=>Date.parse(r.minute_bucket)===Date.parse(c.minute_bucket)-minutes*60000):sessions&&baselineDate?qualifiedChain(historyRows('chain')).filter(r=>date(r.minute_bucket)===baselineDate&&String(r.expiry).slice(0,10)===expiry).at(-1):null;
 const wall=(side:string)=>{const field=side+'_wall_strike',oif=side+'_wall_oi',same=num(c?.[field])!==null&&num(oldChain?.[field])!==null&&c[field]===oldChain[field];return {strike:num(c?.[field]),from:num(oldChain?.[field]),delta:delta(c?.[field],oldChain?.[field]),oi:num(c?.[oif]),oiDelta:same?delta(c?.[oif],oldChain?.[oif]):null,reason:same?'Same wall strike':!oldChain?'Exact baseline unavailable':'Wall migrated; old/new OI belongs to different strikes',at:c?.minute_bucket||null,fromAt:oldChain?.minute_bucket||null};};
 const pcr={...metrics(chain,'full_chain_oi_pcr','chain'),source:c?.full_pcr_source||'Unavailable',expiry,points:chain.map(r=>({at:r.minute_bucket,value:num(r.full_chain_oi_pcr)}))};
 if(sessions){const daily=new Map<string,any>();qualifiedChain(historyRows('chain')).filter(r=>String(r.expiry).slice(0,10)===expiry&&date(r.minute_bucket)>=String(baselineDate||tradeDate)).concat(chain).forEach(r=>daily.set(date(r.minute_bucket),r));pcr.points=[...daily.values()].map(r=>({at:r.minute_bucket,value:num(r.full_chain_oi_pcr)}));}
 // The generic chain baseline must retain the selected exact expiry.
 if(sessions){pcr.from=num(oldChain?.full_chain_oi_pcr);pcr.fromAt=oldChain?.minute_bucket||null;pcr.delta=delta(c?.full_chain_oi_pcr,oldChain?.full_chain_oi_pcr);pcr.percent=pct(c?.full_chain_oi_pcr,oldChain?.full_chain_oi_pcr);}
 const synced=expiry===oppositeExpiry&&spot.at===ce.at&&ce.at===pe.at&&spot.fromAt===ce.fromAt&&ce.fromAt===pe.fromAt&&!!spot.fromAt;
 const bias=synced&&spot.delta!==null&&ce.delta!==null&&pe.delta!==null?spot.delta>0&&ce.delta>0&&pe.delta<0?'CE_SUPPORTING':spot.delta<0&&ce.delta<0&&pe.delta>0?'PE_SUPPORTING':'MIXED':'UNVERIFIED';
 const events:any[]=[];
 optionGroups.forEach(rows=>rows.forEach((r,i)=>{if(String(r.expiry).slice(0,10)!==expiry)return;const before=rows[i-1],price=num(r.ltp);if(price===null)return;for(const [field,direction]of [['pdh','ABOVE PDH'],['pdl','BELOW PDL']]){const level=num(r[field]);if(level===null||level<=0)continue;const outside=field==='pdh'?price>level:price<level;if(!outside)continue;const gap=before?(Date.parse(r.minute_bucket)-Date.parse(before.minute_bucket))/60000:null,comparable=before&&num(before[field])===level&&num(before.ltp)!==null&&gap!>0&&gap!<=3,crossed=comparable&&(field==='pdh'?before.ltp<=level:before.ltp>=level);if(!before||!comparable||crossed)events.push({...r,event:direction,level,previous:num(before?.ltp),previousAt:before?.minute_bucket||null,gapMinutes:gap,kind:crossed?'Observed crossing interval':'First observed outside level'});}}));
 chain.forEach((r,i)=>{const before=chain[i-1];if(!before)return;const gap=(Date.parse(r.minute_bucket)-Date.parse(before.minute_bucket))/60000;if(gap<=0||gap>3)return;for(const side of ['call','put']){const f=side+'_wall_strike',a=num(r[f]),b=num(before[f]);if(a!==null&&b!==null&&a!==b)events.push({symbol,expiry,side:side.toUpperCase(),minute_bucket:r.minute_bucket,previousAt:before.minute_bucket,from:b,to:a,oldOi:num(before[side+'_wall_oi']),newOi:num(r[side+'_wall_oi']),gapMinutes:gap});}});
 events.sort((a,b)=>Date.parse(b.minute_bucket)-Date.parse(a.minute_bucket));
 const expiryPairs=buckets.slice(0,4).map(e=>({expiry:e,ce:premium(e,strike,'CE'),pe:premium(e,strike,'PE')}));
 const behaviour=[...optionGroups.values()].map(rs=>rs.at(-1)).filter(r=>String(r.expiry).slice(0,10)===expiry).map(r=>premium(expiry,Number(r.strike),r.option_type));
 return {symbol,tradeDate,priorDate,baselineDate,window,minutes,sessions,expiry,oppositeExpiry,expiries:buckets,strike,strikes,spot,future,ce,pe,pcr,callWall:wall('call'),putWall:wall('put'),bias,synced,expiryPairs,behaviour,events,vix:metrics(market,'india_vix','market'),truth:'TRUE recorded rows only',historyDates:[...new Set(historyRows('market').map(r=>date(r.minute_bucket)))].sort(),fourthExpiryMissing:buckets.length<4};
}
