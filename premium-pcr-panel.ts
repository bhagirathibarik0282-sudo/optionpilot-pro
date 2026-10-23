import { deriveLiveThreeIndexPcr } from './live-three-index-pcr.js';

/** Bounded, browser-only comparisons. Uses existing one-minute REST observations. */
export function derivePremiumPcrPanel(payload:any,view:any,previous:any=null,scope='FULL',periodMs=60000){
 const period=[60000,180000].includes(periodMs)?periodMs:60000,kind=scope==='BAND'?'BAND':'FULL';
 // Read the latest completed collector cycle, independently of another view's 3m display setting.
 const display=payload?.snapshot?.indices?{...payload,pcrDisplay:Object.fromEntries(payload.snapshot.indices.map((a:any)=>[a.symbol,a.pcrSnapshot?{...a.pcrSnapshot,expiry:a.expiry,periodMs:60000}:payload.pcrDisplay?.[a.symbol]]))}:payload;
 const freshView=deriveLiveThreeIndexPcr(display),now=Date.parse(payload?.serverTime||'');
 const key=freshView.key+'|'+kind+'|'+period,backward=previous?.key===key&&now<previous.serverAt,prior=previous?.key===key?previous:null;
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 const day=(at:number)=>Number.isFinite(at)?new Date(at+19800000).toISOString().slice(0,10):'';
 const volume=(v:any,expected:number)=>{
  if(!v||v.expected!==expected||![v.ceTotal,v.peTotal].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  const value=v.ceTotal>0?v.peTotal/v.ceTotal:null;
  if(value===null?v.value!==null:!finite(v.value)||Math.abs(v.value-value)>Math.max(1,value)*1e-12)return null;
  return {ce:v.ceTotal,pe:v.peTotal,value};
 };
 const rows=freshView.rows.map((r:any)=>{
  const matches=payload?.snapshot?.indices?.filter((a:any)=>a.symbol===r.symbol)||[],a=matches.length===1?matches[0]:null,q=a?.pcrSnapshot,b=q?.bandPcr;
  let current:any=null,reported:any=null;
  if(kind==='FULL'){
   const c=r.current;
   if(c)current={value:c.value,ce:c.ceTotal,pe:c.peTotal,checked:c.checked,cycle:c.cycle,expiry:r.expiry,identity:r.expiry+'|'+c.expected,expected:c.expected,volume:q?.checkedAt===new Date(c.checked).toISOString()&&q?.fetchState==='OK'?volume(q.volume,c.expected):null};
   else if(r.reportedPcr)reported={...r.reportedPcr,volume:volume(r.reportedPcr.volume,r.reportedPcr.expected)};
  }else{
   const checked=Date.parse(q?.checkedAt||''),cycle=Date.parse(q?.cycleStartedAt||''),lo=Date.parse(b?.sourceMinAt||''),hi=Date.parse(b?.sourceMaxAt||''),anchorAt=Date.parse(b?.anchorAt||'');
   const strikes=b?.strikes,parts=typeof b?.membershipKey==='string'?b.membershipKey.split('|'):[];
   const memberOk=parts.length===30&&new Set(parts).size===30&&Array.isArray(strikes)&&strikes.length===15&&strikes.every((s:any,i:number)=>finite(s)&&s>0&&(!i||s>strikes[i-1]))&&strikes[0]===b.fromStrike&&strikes[7]===b.anchorStrike&&strikes[14]===b.toStrike&&strikes.every((s:number)=>['CE','PE'].every(side=>parts.filter((p:string)=>{const [token,strike,type,...rest]=p.split(':');return !rest.length&&Number.isSafeInteger(Number(token))&&Number(token)>0&&Number(strike)===s&&type===side;}).length===1))&&new Set(parts.map((p:string)=>Number(p.split(':')[0]))).size===30;
   const ok=freshView.live&&r.coverageInfo&&q?.source==='KITE_REST_FULL_EXPIRY_SNAPSHOT'&&q.fetchState==='OK'&&['COMPLETE','INCOMPLETE'].includes(q.state)&&b?.state==='COMPLETE'&&b.halfWidth===7&&b.strikeCount===15&&b.expected===30&&b.freshOi===30&&q.coverage.expected>=30&&q.coverage.freshOi>=30&&memberOk&&finite(b.ceTotal)&&b.ceTotal>0&&finite(b.peTotal)&&b.peTotal>=0&&finite(b.value)&&Math.abs(b.value-b.peTotal/b.ceTotal)<=Math.max(1,b.value)*1e-12&&[checked,cycle,lo,hi,anchorAt].every(t=>finite(t)&&day(t)===payload.snapshot.tradeDate)&&cycle<=checked&&checked-cycle<=60000&&now-checked>=0&&now-checked<=90000&&lo<=hi&&checked-lo>=-5000&&checked-lo<=30000&&checked-hi>=-5000&&Math.max(hi,anchorAt)-Math.min(lo,anchorAt)<=30000;
   if(ok)current={value:b.value,ce:b.ceTotal,pe:b.peTotal,checked,cycle,expiry:r.expiry,identity:r.expiry+'|'+b.membershipKey,expected:30,from:b.fromStrike,to:b.toStrike,anchor:b.anchorStrike,volume:volume(b.volume,30)};
  }
  const old=prior?.rows?.find((x:any)=>x.symbol===r.symbol);let samples:any[]=old?.samples||[],conflict=false,rejectedCycle:number|null=null;
  if(backward){current=null;reported=null;samples=[];conflict=true;}
  if(current&&(old?.rejectedCycle===current.cycle||old?.current?.cycle===current.cycle&&JSON.stringify(current)!==JSON.stringify(old.current))){rejectedCycle=current.cycle;current=null;conflict=true;}
  if(!current)samples=[];
  else{
   if(samples.length&&samples.at(-1).identity!==current.identity)samples=[];
   const last=samples.at(-1);
   if(last&&current.cycle===last.cycle){if(JSON.stringify(current)!==JSON.stringify(last)){samples=[];current=null;conflict=true;}}
   else if(last&&current.cycle<last.cycle){samples=[];current=null;conflict=true;}
   else{if(last&&(current.cycle-last.cycle<60000||current.cycle-last.cycle>90000))samples=[];samples=[...samples,current].slice(-8);}
  }
  const steps=period/60000,baseline=current&&samples.length>steps?samples[samples.length-1-steps]:null;
  const comparable=baseline&&current.cycle-baseline.cycle>=period&&current.cycle-baseline.cycle<=period+30000;
  const delta=comparable?current.value-baseline.value:null;
  const direction=delta===null?'WAIT':delta>0?'UP':delta<0?'DOWN':'FLAT';
  const volumeDelta=comparable&&current.volume&&baseline.volume&&current.volume.ce>=baseline.volume.ce&&current.volume.pe>=baseline.volume.pe?{ce:current.volume.ce-baseline.volume.ce,pe:current.volume.pe-baseline.volume.pe}:null;
  return {symbol:r.symbol,expiry:r.expiry,spotValue:r.spotValue,spotAt:r.spotAt,current,reported:conflict?null:reported,rejectedCycle,samples,direction,delta,oiDelta:comparable?{ce:current.ce-baseline.ce,pe:current.pe-baseline.pe}:null,volumeDelta,baselineAt:comparable?baseline.checked:null,status:conflict?'CONFLICTING_OR_OLD_SNAPSHOT':current?'FRESH SNAPSHOT':reported?'Reported · mixed times':r.pcrStatus||'UNAVAILABLE'};
 });
 return {key,serverAt:now,scope:kind,periodMs:period,rows};
}
