/** One session in memory; dates play in order, never interpolate overnight or fill a gap. */
export function mergeRecordedParts(parts:any[]) {
 const merged:any={};
 // Compact tables add null columns for optional keys present on OTHER rows in a window.
 // Missing key and explicit null both mean unavailable; key order is not market evidence.
 const signature=(row:any)=>JSON.stringify(Object.keys(row).filter(key=>row[key]!==null&&row[key]!==undefined).sort().map(key=>[key,row[key]]));
 for(const kind of ['market','options','chain']){
  const rows=new Map<string,any>();
  for(const part of parts){const table=part[kind];for(const values of table?.rows||[]){
   const row=Object.fromEntries(table.columns.map((key:string,i:number)=>[key,values[i]]));
   const key=JSON.stringify([row.symbol,row.minute_bucket,row.expiry,row.strike,row.option_type]),prior=rows.get(key);
   if(prior&&signature(prior)!==signature(row))throw new Error('Conflicting saved '+kind+' rows at '+row.minute_bucket+'. Replay stopped.');
   if(!prior)rows.set(key,row);
  }}
  merged[kind]=[...rows.values()];
 }
 return merged;
}

export function recordedSession(input:any, symbol:string, date:string) {
 const unpack=(table:any):any[]=>Array.isArray(table)?table:table?.columns&&table?.rows?table.rows.map((row:any[])=>Object.fromEntries(table.columns.map((key:string,i:number)=>[key,row[i]]))):[];
 const valid=(row:any)=>row.symbol===symbol&&row.truth_verdict==='TRUE'&&Number.isFinite(Date.parse(row.minute_bucket))&&new Date(Date.parse(row.minute_bucket)+19800000).toISOString().slice(0,10)===date;
 const numeric=['spot_ltp','spot_prev_close','pdh','pdl','future_ltp','future_basis','india_vix','strike','ltp','oi','pdc','full_chain_oi_pcr','call_wall_strike','put_wall_strike'];
 const data:any={};for(const kind of ['market','options','chain'])data[kind]=unpack(input[kind]).filter(valid).map(row=>{
  const copy={...row,minute_bucket:new Date(row.minute_bucket).toISOString()};
  for(const key of numeric)if(Object.hasOwn(copy,key)){const value=copy[key];copy[key]=typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Math.abs(Number(value))<=Number.MAX_SAFE_INTEGER?Number(value):null;}
  return copy;
 });
 const timeline=[...new Set<string>(['market','options','chain'].flatMap(kind=>data[kind].map((row:any)=>row.minute_bucket)))].sort();
 return {symbol,date,...data,timeline,cadenceMinutes:date>='2026-10-19'?1:3,continuity:input.continuity||null};
}

export function recordedFrame(session:any, index:number) {
 const at=session?.timeline?.[index]||null, frame:any={at,date:session?.date||'',symbol:session?.symbol||'',gapMinutes:null};
 for(const kind of ['market','options','chain'])frame[kind]=at?(session[kind]||[]).filter((row:any)=>row.minute_bucket===at):[];
 if(index>0&&at)frame.gapMinutes=(Date.parse(at)-Date.parse(session.timeline[index-1]))/60000;
 return frame;
}

/** Async queue with cancellation: pause/new selection must invalidate in-flight day loads. */
export function createRecordedPlayback(api:any) {
 let generation=0,timer:any=null,abort:any=null;
 const state:any={days:[],dayIndex:0,index:0,session:null,playing:false,loading:false,error:'',speed:1};
 const emit=()=>api.render({...state,frame:recordedFrame(state.session,state.index)});
 function clear(){if(timer!==null)api.clearTimeout(timer);timer=null;}
 function pause(){generation++;clear();abort?.abort();abort=null;state.playing=false;state.loading=false;emit();}
 function schedule(){clear();if(state.playing)timer=api.setTimeout(()=>{timer=null;void next(true);},1000/state.speed);}
 async function loadDay(position:number,token:number) {
  state.loading=true;state.error='';state.session=null;state.index=0;state.dayIndex=position;emit();
  const controller=new AbortController();abort=controller;
  try {
   const session=await api.load(state.days[position],controller.signal);
   if(token!==generation)return false;
   state.session=session;state.loading=false;abort=null;
   if(!session.timeline.length){state.error='No TRUE recordings for '+state.days[position]+'. Playback stopped; this day was not skipped.';state.playing=false;}
   emit();return !!session.timeline.length;
  }catch(error:any){if(token!==generation)return false;state.loading=false;state.playing=false;state.error=error?.message||'Recorded session could not be loaded';abort=null;emit();return false;}
 }
 async function start(days:string[],play=true){
  pause();state.days=[...new Set(days)].sort();state.dayIndex=0;state.index=0;state.session=null;state.error='';
  if(!state.days.length){state.error='Choose at least one recorded day.';emit();return;}
  const token=generation;state.playing=play;
  if(await loadDay(0,token))schedule();
 }
 async function next(automatic=false){
  if(state.loading)return;
  if(!automatic){pause();}
  if(!state.session)return;
  if(state.index<state.session.timeline.length-1){state.index++;emit();schedule();return;}
  if(state.dayIndex<state.days.length-1){const token=generation;if(await loadDay(state.dayIndex+1,token))schedule();return;}
  state.playing=false;clear();emit();
 }
 return {start,pause,next:()=>next(false),
  toggle(){if(state.playing){pause();return;}if(state.loading||!state.days.length)return;if(!state.session){const token=generation;state.playing=true;void loadDay(state.dayIndex,token).then(ok=>{if(ok)schedule();});return;}if(state.index===state.session.timeline.length-1&&state.dayIndex===state.days.length-1){if(state.dayIndex){void start(state.days,true);return;}state.index=0;}state.playing=true;emit();schedule();},
  seek(index:number){pause();state.index=Math.max(0,Math.min((state.session?.timeline.length||1)-1,Math.trunc(index)));emit();},
  speed(value:number){if(![1,5,10].includes(value))return;state.speed=value;emit();schedule();},
  snapshot:()=>({...state,frame:recordedFrame(state.session,state.index)})};
}
