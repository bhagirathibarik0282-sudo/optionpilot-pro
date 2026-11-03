/** The display boundary: every recorded consumer gets the same past-only state. */
export function projectDashboardReplay(state:any,frame:any,loading=false){
 const symbols=['NIFTY','SENSEX','BANKNIFTY'],current:any={},history:any={},baseline:any={},health:any={};
 for(const symbol of symbols){
  current[symbol]=loading?{market:[],options:[],chain:[]}:frame?.current?.[symbol]||{market:[],options:[],chain:[]};
  history[symbol]=loading?[]:frame?.history?.[symbol]||[];baseline[symbol]=null;
  health[symbol]={state:loading?'LOADING':'REPLAY',freshness:{state:loading?'LOADING':'RECORDED',latestAt:loading?null:frame?.at||null},message:'Recorded playback; no live substitution'};
 }
 return {...state,current,history,baseline,health,date:frame?.date||state.date,
  stocks:{},sectors:null,cash:null,cashLoading:false,cashError:'Unavailable at replay time',ratings:[],
  quoteStatus:{},quoteLoading:false,replay:{active:true,at:loading?null:frame?.at||null,playing:!loading&&!!frame?.playing,timeline:frame?.timeline||[],index:frame?.index??0},
  loading:loading||!!state.loading,archiveLoading:loading||!!state.archiveLoading};
}

/** Uses the recorder's existing clock. Only one day is loaded at a time. */
export function installUnifiedDashboardReplay(api:any,controller:any){
 const $=(id:string)=>document.getElementById(id) as any;
 const bar=$('dashboard-replay');if(!bar||!controller)return null;
 let active=false,frame:any=null,days:string[]=[],dayIndex=0,loading=false,error='',generation=0,notifying=false,previous:any=null,projection:any=null,projectionKey:any[]=[],datesKey='';
 const time=(at:any)=>at?new Date(at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}):'No record';
 function notify(force=false){projection=null;if(notifying)return;notifying=true;try{paint();if(active||force)api.render();}finally{notifying=false;}}
 function paint(){
  $('dr-toggle').textContent=active?'Return to Live':'Replay dashboard';$('dr-toggle').setAttribute('aria-pressed',String(active));
  $('dr-label').textContent=active?'REPLAY · '+(frame?.date||'')+' · '+time(frame?.at)+' IST':'Replay · recorded dashboard';
  $('dr-status').textContent=active?'REPLAY · '+((loading||error?days[dayIndex]:frame?.date)||api.getState().date||'')+' · '+time(loading?null:frame?.at)+' IST · '+(loading?'Loading recorded day':error||(!frame?.at?'No TRUE recordings':frame.playing?'Playing':'Paused'))+(days.length?' · day '+(dayIndex+1)+' / '+days.length:''):'LIVE dashboard · select Replay for saved observations';
  const timeline=frame?.timeline||[];for(const id of ['dr-play','dr-prev','dr-next','dr-reset','dr-seek','dr-speed'])$(id).disabled=!active||loading||!timeline.length;
  $('dr-play').textContent=frame?.playing?'Pause':'Play';$('dr-seek').max=String(Math.max(0,timeline.length-1));$('dr-seek').value=String(Math.max(0,frame?.index||0));$('dr-speed').value=String(frame?.speed||1);
  const dates=(api.getState().recordedDates||[]).slice().sort(),signature=dates.join('|');if(datesKey!==signature){$('dr-date').innerHTML=dates.map((d:string)=>'<option>'+d+'</option>').join('');datesKey=signature;}$('dr-date').value=frame?.date||api.getState().date;
  $('dr-date').disabled=loading;for(const id of ['dr-3','dr-5','dr-all'])$(id).disabled=loading||!dates.length;
 }
 function pause(){generation++;controller.stop();}
 function toggle(value:boolean){generation++;loading=false;error='';active=value;controller.setEmbeddedActive(value);if(!value)controller.stop();notify(true);}
 async function loadDay(index:number,play:boolean,token:number){
  loading=true;error='';dayIndex=index;controller.stop();notify();
  try{await api.setDate(days[index],{scope:'FULL',fullSession:true});if(token!==generation)return;
   const state=api.getState();if(state.date!==days[index]||state.scope!=='FULL'||['NIFTY','SENSEX','BANKNIFTY'].some(s=>['UNAVAILABLE','PARTIAL','RETAINED'].includes(state.health?.[s]?.state)))throw Error('Recorded day is incomplete; playback stopped.');
   controller.render(true);controller.reset();loading=false;
   if(!frame?.at)throw Error('No TRUE recordings; playback stopped without skipping this day.');
   notify();if(play&&active)controller.playPause();
  }catch(e:any){if(token===generation){loading=false;error=e?.message||'Recorded day failed';controller.stop();notify();}}
 }
 async function start(selected:string[],play=true){pause();days=[...new Set<string>(selected.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&(api.getState().recordedDates||[]).includes(d)))].sort();dayIndex=0;active=true;controller.setEmbeddedActive(true);if(!days.length){error='No saved dates available';notify();return;}const token=++generation;await loadDay(0,play,token);}
 controller.subscribe((next:any)=>{const prior=previous;frame=next;previous=next;projection=null;
  if(active&&!loading&&!error&&days.length&&next.date!==days[dayIndex]){days=[];dayIndex=0;}
  notify();
  if(active&&!loading&&prior?.playing&&!next.playing&&next.at&&next.index===next.timeline.length-1&&next.index>prior.index&&dayIndex<days.length-1){const token=++generation;void loadDay(dayIndex+1,true,token);}
 });
 $('dr-toggle').onclick=()=>toggle(!active);
 if($('rd-replay-link'))$('rd-replay-link').onclick=()=>{bar.open=true;toggle(true);};
 $('dr-play').onclick=()=>{if(!active||loading)return;error='';controller.playPause();};
 $('dr-prev').onclick=()=>{pause();controller.step(-1);};$('dr-next').onclick=()=>{pause();if(frame?.index===frame?.timeline?.length-1&&dayIndex<days.length-1)void loadDay(dayIndex+1,false,++generation);else controller.step(1);};
 $('dr-reset').onclick=()=>{pause();if(dayIndex>0)void loadDay(0,false,++generation);else controller.reset();};
 $('dr-seek').oninput=()=>{pause();controller.seek(Number($('dr-seek').value));};$('dr-speed').onchange=()=>controller.speed(Number($('dr-speed').value));
 $('dr-date').onchange=()=>void start([$('dr-date').value],false);
 for(const [id,count] of [['dr-3',3],['dr-5',5],['dr-all',0]] as const)$(id).onclick=()=>{const dates=(api.getState().recordedDates||[]).slice().sort();void start(count?dates.slice(-count):dates);};
 if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{generation++;controller.stop();});
 paint();return {active:()=>active,paint,start,toggle,pause,getState(){const state=api.getState();if(!active)return state;const key=[state.date,state.scope,state.recordedDates,state.loading,state.archiveLoading,frame,loading,...['NIFTY','SENSEX','BANKNIFTY'].flatMap(s=>[state.current?.[s],state.history?.[s],state.baseline?.[s]])];if(!projection||key.some((v,i)=>v!==projectionKey[i])){projectionKey=key;projection=projectDashboardReplay(state,error?{...frame,date:days[dayIndex]||frame?.date}:frame,loading||!!error);}return projection;}};
}
export const DASHBOARD_REPLAY_HTML=`<details id="dashboard-replay" aria-label="Dashboard replay"><summary id="dr-label">Replay · recorded dashboard</summary><div class="mb-controls"><button type="button" id="dr-toggle" aria-pressed="false">Replay dashboard</button><label>Recorded day<select id="dr-date"></select></label><button type="button" id="dr-3">Last 3 days</button><button type="button" id="dr-5">Last 5 days</button><button type="button" id="dr-all">All saved days</button></div><div class="mb-controls"><button type="button" id="dr-prev">← Record</button><button type="button" id="dr-play">Play</button><button type="button" id="dr-next">Record →</button><button type="button" id="dr-reset">Reset</button><label>Speed<select id="dr-speed"><option value="1">1×</option><option value="5">5×</option><option value="10">10×</option></select></label><label>Time<input id="dr-seek" type="range" min="0" max="0" value="0"></label></div><p id="dr-status" role="status" aria-live="polite"></p></details>`;
