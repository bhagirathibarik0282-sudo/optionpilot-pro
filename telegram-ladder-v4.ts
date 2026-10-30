/** Pure presentation/report planner. No network, timer, order or legacy-cutover side effects. */
export const LADDER_PREFIX = '📊 OPTIONPILOT LADDER V4 | ';
export const SYMBOLS = ['NIFTY','SENSEX','BANKNIFTY'] as const;
export type SymbolName = typeof SYMBOLS[number];
export type Quality = 'VERIFIED'|'UNVERIFIED'|'STALE'|'MISSING';
export type Value = { value:number|null; quality:Quality; source:string };
export type Wall = { strike:number|null; oi:Value };
export type Expiry = { expiry:string; pcr:Record<'full'|'band7'|'volume',Value>;
  volumeScope:string; ceWall:Wall; peWall:Wall;
  contracts:{strike:number;side:'CE'|'PE';ltp:Value;pdh:Value;pdl:Value}[] };
export type IndexFrame = {symbol:SymbolName;spot:Value;pdh:Value;pdl:Value;expiries:Expiry[]};
export type Participation = {key:string;label:string;role:'STOCK'|'SECTOR';price:Value;
  dayChange:Value;weight:Value};
export type MinuteFrame = {minute:string;indices:IndexFrame[];participation:Participation[]};
export type Window = {date:string;from:string;to:string;timeframe:1|3|15|30|60|'EOD';partial:boolean};
const M=60_000, OFFSET=330*M;
export const missing = (source='NOT_RECORDED'):Value=>({value:null,quality:'MISSING',source});
export function numeric(v:unknown):number|null {
  if(typeof v!=='number' && typeof v!=='string') return null;
  if(typeof v==='string' && !v.trim()) return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
export function value(v:unknown,quality:Quality,source:string):Value {
  const n=numeric(v); return n===null?missing(source):{value:n,quality,source};
}
function validDate(d:string) {return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;}
function ms(s:string):number {
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(s)) throw Error('EXPLICIT_TIMEZONE_REQUIRED');
  const t=Date.parse(s);if(!Number.isFinite(t))throw Error('INVALID_TIME');return t;
}
const iso=(t:number)=>new Date(t).toISOString();
const date=(t:number)=>new Date(t+OFFSET).toISOString().slice(0,10);
const clock=(t:number)=>new Date(t+OFFSET).toISOString().slice(11,16);
function bounds(d:string) {if(!validDate(d))throw Error('INVALID_SESSION_DATE'); const open=Date.parse(d+'T09:15:00+05:30'); return {open,close:open+375*M};}
function fmt(n:number) {return n.toLocaleString('en-IN',{maximumFractionDigits:3});}
function safe(s:string) {return String(s).replace(/[\r\n\t\u0000-\u001f]/g,' ').slice(0,160);}
function display(v:Value|undefined) {
  if(!v || v.value===null || !Number.isFinite(v.value))return '⚪ MISSING';
  return `${fmt(v.value)}${v.quality==='VERIFIED'?'':v.quality==='STALE'?' ⚪ STALE':' ⚪ UNVERIFIED'}`;
}
function sign(n:number) {return n>0?'🟢⬆️':n<0?'🔴⬇️':'—';}
function change(a:Value|undefined,b:Value|undefined,percent=false) {
  if(!a || !b || a.quality!=='VERIFIED' || b.quality!=='VERIFIED' || a.value===null || b.value===null || a.source!==b.source)return '⚪ Δ ତୁଳନା ଅନୁପଲବ୍ଧ';
  if(percent && a.value===0)return '⚪ Δ% baseline 0';
  const n=percent?(b.value-a.value)/a.value*100:b.value-a.value;
  return `${sign(n)} ${n>0?'+':''}${fmt(n)}${percent?'%':''}`;
}
function levels(ltp:Value,pdh:Value,pdl:Value,label:string):string[] {
  const rows=[{label,v:ltp},{label:'PDH',v:pdh},{label:'PDL',v:pdl}];
  rows.sort((a,b)=>(b.v.value??-Infinity)-(a.v.value??-Infinity));
  return rows.flatMap(r=>[`    ${r.label}`,`      ${display(r.v)}`]);
}
function findIndex(f:MinuteFrame|undefined,s:SymbolName){return f?.indices.find(i=>i.symbol===s);}
function findExpiry(i:IndexFrame|undefined,e:string){return i?.expiries.find(x=>x.expiry===e);}
/** Session-anchored endpoints, including 15-minute partials at 15:30 for 30/60m. */
export function sessionWindows(d:string):Window[] {
  const {open,close}=bounds(d),out:Window[]=[];
  for(const tf of [1,3,15,30,60] as const) {
    if(tf===1)out.push({date:d,from:iso(open),to:iso(open),timeframe:1,partial:false});
    for(let start=open;start<close;start+=tf*M)out.push({date:d,from:iso(start),to:iso(Math.min(start+tf*M,close)),timeframe:tf,partial:start+tf*M>close});
  }
  return out.sort((a,b)=>ms(a.to)-ms(b.to)||Number(a.timeframe)-Number(b.timeframe));
}
export function dueWindows(d:string,now:number):Window[] {return sessionWindows(d).filter(w=>ms(w.to)+M<=now);}
function selectedFrames(frames:readonly MinuteFrame[],w:Window) {
  const {open,close}=bounds(w.date),from=ms(w.from),to=ms(w.to);
  if(from<open||to>close||from>to||from%M||to%M)throw Error('INVALID_WINDOW');
  const map=new Map<number,MinuteFrame>();
  for(const f of frames) {const t=ms(f.minute);if(t%M)throw Error('NOT_MINUTE_BUCKET');if(t<from||t>to)continue;if(map.has(t))throw Error('DUPLICATE_MINUTE');
    if(new Set(f.indices.map(i=>i.symbol)).size!==f.indices.length)throw Error('DUPLICATE_INDEX');
    map.set(t,f);
  }
  return {map,from,to};
}
function indexLines(s:SymbolName,a:IndexFrame|undefined,b:IndexFrame|undefined,d:string):string[] {
  if(!b)return [s,'  ⚪ ଏହି minuteର index record ନାହିଁ'];
  const out=[s,...levels(b.spot,b.pdh,b.pdl,'SPOT'),`  Spot Δ ${change(a?.spot,b.spot)}`,
    `  Spot source: ${safe(b.spot.source)}`];
  if(!b.expiries.length)out.push('  ⚪ Expiry record ନାହିଁ');
  const seen=new Set<string>();
  for(const e of [...b.expiries].sort((a,b)=>a.expiry.localeCompare(b.expiry))) {
    if(!validDate(e.expiry)||seen.has(e.expiry))throw Error('INVALID_OR_DUPLICATE_EXPIRY');seen.add(e.expiry);
    const dte=(Date.parse(e.expiry)-Date.parse(d))/86_400_000;
    const before=findExpiry(a,e.expiry);
    out.push(`  Expiry ${e.expiry}`,`    DTE ${dte}${dte<0?' ⚪ EXPIRED':''}`,'    PCR');
    for(const [key,label] of [['full','Full OI'],['band7','±7 OI'],['volume',`Volume (${safe(e.volumeScope)})`]] as const)out.push(`      ${label}`,`        ${display(e.pcr[key])}`,`        Δ ${change(key==='volume'&&before?.volumeScope!==e.volumeScope?undefined:before?.pcr[key],e.pcr[key])}`,`        source: ${safe(e.pcr[key].source)}`);
    for(const [key,label] of [['ceWall','CE wall'],['peWall','PE wall']] as const) {
      const wall=e[key],old=before?.[key];out.push(`    ${label}`,`      Strike ${wall.strike===null?'⚪ MISSING':fmt(wall.strike)}`,`      OI ${display(wall.oi)}`);
      if(old && old.strike!==null && wall.strike!==null && old.strike!==wall.strike)out.push(`      Strike migration ${fmt(old.strike)} → ${fmt(wall.strike)}`,'      OI Δ: ଭିନ୍ନ strike; ତୁଳନା ନାହିଁ');
      else out.push(`      OI Δ ${old?.strike===wall.strike?change(old?.oi,wall.oi,true):'⚪ baseline ନାହିଁ'}`);
    }
    const keys=new Set<string>();
    for(const c of [...e.contracts].sort((a,b)=>a.strike-b.strike||a.side.localeCompare(b.side))) {
      const key=`${c.strike}|${c.side}`;
      if(!Number.isFinite(c.strike)||c.strike<=0||!['CE','PE'].includes(c.side)||keys.has(key))throw Error('INVALID_OR_DUPLICATE_CONTRACT');keys.add(key);
      const prev=before?.contracts.find(p=>p.strike===c.strike&&p.side===c.side);
      out.push(`    Strike ${c.strike} ${c.side}`,...levels(c.ltp,c.pdh,c.pdl,'LTP'),`      LTP Δ ${change(prev?.ltp,c.ltp,true)}`,`      source: ${safe(c.ltp.source)}`);
    }
  }
  if(s==='BANKNIFTY')out.push('  କେବଳ ଗବେଷଣା ପାଇଁ');return out;
}
function alignment(a:MinuteFrame|undefined,b:MinuteFrame|undefined):string[] {
  const out=['PCR DIRECTION ALIGNMENT'];
  for(const key of ['full','band7','volume'] as const) {
    const directions:number[]=[],scopes:string[]=[];
    for(const s of SYMBOLS) {
      // Earliest recorded expiry per index; expiry dates differ across indices by design.
      const bi=findIndex(b,s),ai=findIndex(a,s),e=bi?.expiries.slice().sort((x,y)=>x.expiry.localeCompare(y.expiry))[0];
      const prev=e&&findExpiry(ai,e.expiry),x=prev?.pcr[key],y=e?.pcr[key];
      if(x?.quality==='VERIFIED'&&y?.quality==='VERIFIED'&&x.value!==null&&y.value!==null&&x.source===y.source&&(key!=='volume'||prev?.volumeScope===e?.volumeScope)){directions.push(Math.sign(y.value-x.value));if(key==='volume')scopes.push(e!.volumeScope);}
    }
    out.push(`  ${key}`,(directions.length!==3||(key==='volume'&&new Set(scopes).size!==1))?'    ⚪ 3/3 ଯାଞ୍ଚିତ baseline ନାହିଁ':`    ${directions.every(x=>x===1)?'🟢 3/3 ⬆️':directions.every(x=>x===-1)?'🔴 3/3 ⬇️':directions.every(x=>x===0)?'— 3/3':`🟡 ${directions.filter(x=>x>0).length}⬆️ / ${directions.filter(x=>x<0).length}⬇️ / ${directions.filter(x=>x===0).length}—`}`);
  }
  out.push('  Direction alignment; buy/sell signal ନୁହେଁ');return out;
}
function participationLines(a:MinuteFrame|undefined,b:MinuteFrame|undefined):string[] {
  const out=['SECTORS / HEAVYWEIGHTS'];
  if(!b?.participation.length)return [...out,'  ⚪ ଏହି minuteର participation record ନାହିଁ'];
  const seen=new Set<string>();
  for(const q of b.participation) {
    if(seen.has(q.key))throw Error('DUPLICATE_PARTICIPATION');seen.add(q.key);
    const prev=a?.participation.find(p=>p.key===q.key);
    out.push(`  ${safe(q.role)} · ${safe(q.label)}`,`    Price ${display(q.price)}`,`    Window Δ ${change(prev?.price,q.price,true)}`,
      `    Day Δ ${display(q.dayChange)}${q.dayChange.value!==null&&q.dayChange.quality==='VERIFIED'?`% ${sign(q.dayChange.value)}`:'%'}`,
      `    Index weight ${display(q.weight)}%`);
  }
  return out;
}
/** Split by complete lines; every part keeps the bypass prefix and report identity. */
export function splitLadder(lines:readonly string[],identity:string,limit=3800):string[] {
  if(!Number.isInteger(limit)||limit<256||limit>4096)throw Error('INVALID_MESSAGE_LIMIT');
  const header=LADDER_PREFIX+safe(identity),bodyLimit=limit-header.length-50;
  const chunks:string[]=[];let buf='';
  for(const line of lines) {
    if(line.length>bodyLimit)throw Error('OVERSIZE_LADDER_LINE');
    if(buf.length+line.length+1>bodyLimit){chunks.push(buf);buf='';}buf+=(buf?'\n':'')+line;
  }
  if(buf||!chunks.length)chunks.push(buf);
  return chunks.map((c,i)=>`${header}\nଭାଗ ${i+1}/${chunks.length}\n${c}`);
}
export function renderWindow(frames:readonly MinuteFrame[],w:Window):string[] {
  if(w.timeframe==='EOD')throw Error('USE_EOD_RENDERER');
  const {map,from,to}=selectedFrames(frames,w),a=from===to?undefined:map.get(from),b=map.get(to);
  const expected=(to-from)/M+1;
  const lines=[`${clock(from)} → ${clock(to)} IST${w.partial?' · PARTIAL':''}`,`Minute coverage ${map.size}/${expected}`,...alignment(a,b)];
  for(const s of SYMBOLS)lines.push('',...indexLines(s,findIndex(a,s),findIndex(b,s),w.date));
  lines.push('',...participationLines(a,b));
  return splitLadder(lines,`${w.timeframe} MIN | ${w.date} | ${clock(from)}-${clock(to)}`);
}
/** All 376 session timestamps, all three indices; missing minutes are explicit, never filled. */
export function renderEod(frames:readonly MinuteFrame[],d:string):string[] {
  const {open,close}=bounds(d),w:Window={date:d,from:iso(open),to:iso(close),timeframe:'EOD',partial:false};
  const {map}=selectedFrames(frames,w),lines=[`${d} · 09:15–15:30 IST`,`Minute coverage ${map.size}/376`];
  for(let t=open;t<=close;t+=M) {
    const b=map.get(t),a=t===open?undefined:map.get(t-M);
    lines.push('',`⏱ ${clock(t)} IST`,...alignment(a,b));
    for(const s of SYMBOLS)lines.push(...indexLines(s,findIndex(a,s),findIndex(b,s),d));
    lines.push(...participationLines(a,b));
  }
  return splitLadder(lines,`EOD | ${d} | 1 MIN HISTORY`);
}
/** Compact chat preface; complete levels, expiries and minute history remain in the attachment. */
export function renderSummary(frames:readonly MinuteFrame[],w:Window):string {
  const {map,from,to}=selectedFrames(frames,w),a=map.get(from),b=map.get(to);
  const lines=[LADDER_PREFIX+`${w.timeframe} | ${w.date} | ${clock(from)}-${clock(to)}`,
    `Minute coverage ${map.size}/${(to-from)/M+1}${w.partial?' · PARTIAL':''}`];
  for(const s of SYMBOLS) {
    const i=findIndex(b,s),prev=findIndex(a,s);lines.push(s,`  Spot ${display(i?.spot)}`,`  Δ ${change(from===to?undefined:prev?.spot,i?.spot)}`);
    const e=i?.expiries.slice().sort((x,y)=>x.expiry.localeCompare(y.expiry))[0];
    if(e){lines.push(`  Expiry ${e.expiry}`);for(const [key,label] of [['full','Full OI PCR'],['band7','±7 OI PCR'],['volume','Volume PCR']] as const)lines.push(`    ${label}`,`      ${display(e.pcr[key])}`);
      lines.push(`  CE wall ${e.ceWall.strike??'⚪ MISSING'}`,`  PE wall ${e.peWall.strike??'⚪ MISSING'}`,`  ସମ୍ପୂର୍ଣ୍ଣ expiry ${i!.expiries.length}: ସଂଲଗ୍ନରେ`);
    }else lines.push('  ⚪ Expiry record ନାହିଁ');
  }
  lines.push(`Sector/stock coverage ${b?.participation.length??0}: ସଂଲଗ୍ନରେ`,'ସମ୍ପୂର୍ଣ୍ଣ ladder ତଥ୍ୟ ସଂଲଗ୍ନ TXTରେ ଅଛି।');
  const text=lines.join('\n');if(text.length>4096)throw Error('SUMMARY_TOO_LONG');return text;
}
