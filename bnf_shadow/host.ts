/** Explicit opt-in lifecycle owner for one SHADOW Python child. No broker orders. */
import { spawn, execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import type { KiteImmediateTokenEntry } from '../kite-immediate-token-registry.js';
import { installBnfShadowTradingFeed } from './market_context.ts';

type Row = { instrument_token: number; tradingsymbol: string; name?: string | null; expiry?: string | null;
  strike?: number | null; instrument_type?: string | null; exchange?: string | null; segment?: string | null };
type Entry = KiteImmediateTokenEntry;
const dateAt = (ms:number) => new Date(ms+19800000).toISOString().slice(0,10);

export function bindBnfHostMaster(entries:Entry[], rows:Row[], asof:string) {
  const byToken=new Map<number,Row>();
  for(const row of rows){if(byToken.has(row.instrument_token))throw Error('MASTER_DUPLICATE_TOKEN');byToken.set(row.instrument_token,row);}
  const selected=entries.filter(e=>e.symbol==='BANKNIFTY');
  const spots=selected.filter(e=>e.role==='SPOT');
  if(spots.length!==1)throw Error('BANKNIFTY_SPOT_REQUIRED');
  const spot=byToken.get(spots[0].instrumentToken);
  if(!spot||spot.exchange!=='NSE'||!spot.segment?.includes('INDICES')||spot.tradingsymbol!==spots[0].instrumentLabel)throw Error('SPOT_MASTER_MISMATCH');
  const options=new Map<number,Row>();
  for(const e of selected.filter(e=>e.role==='OPTION')){
    const r=byToken.get(e.instrumentToken);
    if(!r||r.exchange!=='NFO'||r.name!=='BANKNIFTY'||r.expiry!==e.expiry||r.strike!==e.strike||r.instrument_type!==e.optionSide||r.expiry!<asof)throw Error('OPTION_MASTER_MISMATCH');
    options.set(e.instrumentToken,r);
  }
  if(!options.size)throw Error('BANKNIFTY_OPTIONS_REQUIRED');
  const futures=rows.filter(r=>r.exchange==='NFO'&&r.name==='BANKNIFTY'&&r.instrument_type==='FUT'&&r.expiry&&/^\d{4}-\d{2}-\d{2}$/.test(r.expiry)&&r.expiry>=asof).sort((a,b)=>a.expiry!.localeCompare(b.expiry!));
  if(!futures.length||futures.filter(r=>r.expiry===futures[0].expiry).length!==1)throw Error('UNAMBIGUOUS_NEAR_FUTURE_REQUIRED');
  const future=futures[0];
  const enriched:Entry[]=[{...spots[0]},...selected.filter(e=>e.role==='OPTION'),{instrumentToken:future.instrument_token,symbol:'BANKNIFTY',role:'FUTURE',instrumentLabel:future.tradingsymbol,expiry:future.expiry}];
  return {entries:enriched,options,referenceTokens:entries.some(e=>e.instrumentToken===future.instrument_token)?[]:[future.instrument_token]};
}

export function createBnfShadowHost(config:any,deps:any={}) {
  const state={enabled:config.enabled===true,phase:'DISABLED',reason:'DISABLED',workerStarts:0,feedConnected:false,lots:null as number|null,sourceCounts:null as any,paper:null as any,replayCapture:null as any,brokerOrders:0};
  const health={date:'',updatedAt:null as string|null,startedAt:null as string|null,lastReportAt:null as string|null,
    lastExitAt:null as string|null,exitCode:null as number|null,exitSignal:null as string|null,
    failureStage:null as string|null,failureReason:null as string|null,sourceReason:null as string|null,lastReportedCounts:null as any};
  let child:any=null,endingChild:any=null,binding:any=null,observer:any=null,stopped=false,pending=false,generation=0,attempted=false;
  const now:()=>number=deps.now||Date.now;
  const spawnChild=deps.spawn||spawn;
  const modeEnv=config.env||process.env;
  let prepared:any=null;
  const status=()=>({...state,childRunning:child!==null,relay:binding?.status()??null,health:{...health}});
  const publish=()=>{health.date=dateAt(now());health.updatedAt=new Date(now()).toISOString();try{config.onStatus?.(status());}catch{/* diagnostics must not interrupt feed */}};
  const note=(phase:string,reason:string)=>{state.phase=phase;state.reason=reason;publish();};
  const outputEnv:any={};
  const python=config.python||'python';
  const args=['-m','bnf_shadow','--config',config.configPath];
  const endWorker=()=>{
    binding?.stop();binding=null;observer=null;
    if(child&&endingChild!==child){const owned=child;endingChild=owned;try{owned.stdin.end();}catch{}
      const timer=setTimeout(()=>{if(child===owned)owned.kill('SIGTERM');},10000);timer.unref();
      owned.once('exit',()=>clearTimeout(timer));}
  };
  const stop=()=>new Promise<void>(resolve=>{
    stopped=true;generation++;const owned=child;
    if(owned){const timer=setTimeout(resolve,12000);timer.unref();owned.once('exit',()=>{clearTimeout(timer);resolve();});}
    else resolve();
    endWorker();note('STOPPED','HOST_STOPPED');
  });
  const result={status,stop,referenceTokens:[] as number[],onPackets:(ticks:any[],receivedAt:string)=>{
    if(state.feedConnected&&observer)try{observer(ticks,receivedAt);}catch{endWorker();note('BLOCKED','HOST_PACKET_CALLBACK_FAILED');}
  },onState:(value:string)=>{
    const wasOpen=state.feedConnected;state.feedConnected=value==='OPEN';
    if(!state.feedConnected){generation++;attempted=false;state.sourceCounts=null;state.paper=null;endWorker();if(!stopped&&state.enabled)note('WAIT_FEED','FEED_NOT_OPEN');}
    else if(!wasOpen)void start();
  }};
  if(!state.enabled)return result;
  for(const name of ['PATH','DATABASE_URL','KITE_API_KEY','KITE_SESSION_ENCRYPTION_KEY'])if(typeof modeEnv[name]==='string')outputEnv[name]=modeEnv[name];
  outputEnv.EXECUTION_MODE='SHADOW';outputEnv.PYTHONUNBUFFERED='1';
  if(modeEnv.BNF_SHADOW_REPLAY_CAPTURE_ENABLED==='true'){
    outputEnv.BNF_SHADOW_REPLAY_CAPTURE_ENABLED='true';
    if(typeof modeEnv.RAILWAY_VOLUME_MOUNT_PATH==='string')outputEnv.RAILWAY_VOLUME_MOUNT_PATH=modeEnv.RAILWAY_VOLUME_MOUNT_PATH;
    if(typeof modeEnv.RAILWAY_GIT_COMMIT_SHA==='string'&&/^[a-f0-9]{40}$/.test(modeEnv.RAILWAY_GIT_COMMIT_SHA))outputEnv.RAILWAY_GIT_COMMIT_SHA=modeEnv.RAILWAY_GIT_COMMIT_SHA;
  }

  try{
    if(modeEnv.EXECUTION_MODE&&modeEnv.EXECUTION_MODE!=='SHADOW')throw Error('MODE_MUST_BE_SHADOW');
    if(dateAt(now())!==config.masterDate)throw Error('CURRENT_MASTER_DATE_REQUIRED');
    if(!config.configPath||statSync(config.configPath).size>32768)throw Error('CONFIG_FILE_REQUIRED');
    const cfg=JSON.parse(readFileSync(config.configPath,'utf8'));
    if(cfg.mode!=='SHADOW'||![1,2].includes(cfg.lots))throw Error('CONFIG_MUST_BE_SHADOW');
    state.lots=cfg.lots;
    for(const key of ['DATABASE_URL','KITE_API_KEY','KITE_SESSION_ENCRYPTION_KEY'])if(!outputEnv[key])throw Error('EXISTING_WORKER_VARIABLES_REQUIRED');
    prepared=bindBnfHostMaster(config.entries,config.masterRows,config.masterDate);result.referenceTokens=prepared.referenceTokens;
    note('WAIT_FEED','PREFLIGHT_PENDING');
  }catch{note('BLOCKED','HOST_CONFIGURATION_OR_MASTER_INVALID');stopped=true;return result;}

  function preflight():Promise<any>{
    if(deps.preflight)return deps.preflight();
    return new Promise(resolve=>execFile(python,[...args,'--preflight'],{cwd:config.cwd||process.cwd(),env:outputEnv,timeout:25000,maxBuffer:32768},(err,stdout)=>{
      let report:any;try{report=JSON.parse(stdout.trim());}catch{}
      resolve(report?.ready&&report.status==='SHADOW_PREFLIGHT_READY'?report:{ready:false,status:['JOURNAL_SCHEMA_REQUIRED','CONTRACT_LOT_CONFIG_MISMATCH'].includes(report?.status)?report.status:err&&(err as any).code==='ENOENT'?'PYTHON_UNAVAILABLE':'PREFLIGHT_FAILED'});
    }));
  }
  async function start(){
    if(!state.enabled||stopped||pending||child||attempted||!state.feedConnected)return;
    attempted=true;pending=true;const epoch=generation;
    try{
      if(dateAt(now())!==config.masterDate){note('BLOCKED','MASTER_DAY_CHANGED');return;}
      note('PREFLIGHT','READ_ONLY_RUNTIME_CHECK');
      const report=await preflight();
      if(stopped||epoch!==generation||!state.feedConnected)return;
      if(!report?.ready){note('BLOCKED',['JOURNAL_SCHEMA_REQUIRED','CONTRACT_LOT_CONFIG_MISMATCH','PYTHON_UNAVAILABLE'].includes(report?.status)?report.status:'PREFLIGHT_FAILED');return;}
      const owned=spawnChild(python,args,{cwd:config.cwd||process.cwd(),env:outputEnv,stdio:['pipe','pipe','pipe'],shell:false});
      health.startedAt=new Date(now()).toISOString();health.failureStage=null;health.failureReason=null;
      state.replayCapture=null;
      child=owned;state.workerStarts++;note('STARTING','WAIT_WORKER_READY');
      const readyTimer=setTimeout(()=>{if(child===owned&&state.phase==='STARTING'){endWorker();note('BLOCKED','WORKER_READY_TIMEOUT');}},45000);readyTimer.unref();
      owned.once('exit',()=>clearTimeout(readyTimer));owned.once('error',()=>clearTimeout(readyTimer));
      let buffers={out:'',err:''};
      const line=(raw:string)=>{
        let value:any;try{value=JSON.parse(raw);}catch{return;}
        if(value.status==='SHADOW_WORKER_READY'&&value.mode==='SHADOW'&&value.broker_orders===0&&state.phase==='STARTING'&&!binding&&child===owned&&state.feedConnected&&!stopped){
          // A new worker must never inherit yesterday's or previous connection's counts.
          state.sourceCounts=null;state.paper=null;
          binding=installBnfShadowTradingFeed({enabled:true,writer:owned.stdin,entries:prepared.entries,masterDate:config.masterDate,
            connected:()=>state.feedConnected&&!stopped,now,registerObserver:fn=>{observer=fn;return()=>{observer=null;};},
            contractFor:token=>{const row=prepared.options.get(token);return row?{instrument_token:token,tradingsymbol:row.tradingsymbol}:null;},
            expiryClockFor:(token,observedAt)=>{const row=prepared.options.get(token);const clock=row?config.resolveClock('BANKNIFTY',row.expiry,observedAt):null;
              return clock&&!clock.expired?{expiry_clock_source:'INDEX_EXPIRY_CLOCK',expiry_ts:new Date(clock.expiryMs).toISOString()}:null;}});
          clearTimeout(readyTimer);note('READY','WAIT_EXACT_180S_WARMUP');
        }
        if(value.status==='SHADOW_EXECUTION_STATUS'&&value.broker_orders===0){
          const leg=(row:any)=>{
            if(!row||typeof row!=='object'||Array.isArray(row))return null;
            const allowed=['OPEN','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','EXIT_PENDING','PENDING','CANCELLED','CLOSED','STOPPED','EXPIRED','FILLED'];
            const stateName=typeof row.state==='string'&&allowed.includes(row.state)?row.state:'OTHER';
            const qty=(x:any)=>Number.isSafeInteger(x)&&x>=0?x:null;
            return {state:stateName,requestedQty:qty(row.requested_qty),filledQty:qty(row.filled_qty),exitedQty:qty(row.exited_qty)};
          };
          const reportedAt=typeof value.reported_at==='string'&&Number.isFinite(Date.parse(value.reported_at))?value.reported_at:null;
          state.paper={reportedAt,active:leg(value.active),lastResult:leg(value.last_result)};
          const capture=value.replay_capture;
          if(capture?.mode==='BNF_SHADOW_REPLAY_V1'){
            const n=(v:any)=>Number.isSafeInteger(v)&&v>=0?v:null;
            const code=(v:any)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(v)?v:null;
            state.replayCapture={mode:capture.mode,state:code(capture.state),fault:code(capture.fault),
              recordsWritten:n(capture.recordsWritten),recordsDropped:n(capture.recordsDropped),
              uncompressedBytes:n(capture.uncompressedBytes),completeSessionVerified:false};
          }
          health.lastReportAt=new Date(now()).toISOString();publish();
        }
        if(value.status==='SHADOW_SOURCE_STATUS'){
          const counts:any={};for(const key of ['observations','signals','rejected','warmup','contracts','retained_observations'])if(Number.isSafeInteger(value[key])&&value[key]>=0)counts[key]=value[key];
          state.sourceCounts=counts;
          health.lastReportedCounts={...counts};
          const allowed=['WARMUP','SOURCE_RESET_WARMUP','SIGNAL_EVIDENCE_READY','SOURCE_EVIDENCE_REJECTED','DUPLICATE_OR_OUT_OF_ORDER','CROSS_SESSION_BASELINE','OPPOSITE_CONTRACT_MISSING','EXACT_180S_PAIR_WARMUP','EXPIRY_CLOCK_CHANGED','QUAD_ALIGN_NOT_QUALIFIED'];
          health.sourceReason=allowed.includes(value.reason)?value.reason:null;
          health.lastReportAt=new Date(now()).toISOString();publish();
        }
        if(value.status==='SHADOW_WORKER_STOPPED'&&value.broker_orders===0){
          const stages=['BOOTSTRAP','SESSION_CHECK','JOURNAL_OPEN','ENGINE_START','INPUT_CONSUME','WATCHDOG','SHUTDOWN'];
          const reasons=['SESSION_CHECK_FAILED','JOURNAL_UNAVAILABLE_OR_CONFLICT','CONFIGURATION_INVALID','INPUT_OR_STRATEGY_FAILED','WORKER_INTERNAL_ERROR'];
          health.failureStage=stages.includes(value.stage)?value.stage:null;
          health.failureReason=reasons.includes(value.reason)?value.reason:'WORKER_INTERNAL_ERROR';publish();
        }
      };
      const receive=(key:'out'|'err',chunk:any)=>{
        if(child!==owned)return;
        buffers[key]+=chunk.toString();if(buffers[key].length>32768){endWorker();note('BLOCKED','WORKER_OUTPUT_LIMIT');return;}
        let end;while((end=buffers[key].indexOf('\n'))>=0){const raw=buffers[key].slice(0,end);buffers[key]=buffers[key].slice(end+1);try{line(raw);}catch{endWorker();note('BLOCKED','WORKER_BIND_FAILED');}}
      };
      owned.stdout.on('data',(c:any)=>receive('out',c));owned.stderr.on('data',(c:any)=>receive('err',c));
      owned.on('error',()=>{if(child===owned){child=null;binding?.stop();binding=null;observer=null;note('BLOCKED','WORKER_START_FAILED');}});
      owned.on('exit',(exitCode:any,signal:any)=>{if(child===owned){child=null;binding?.stop();binding=null;observer=null;state.sourceCounts=null;state.paper=null;
        health.lastExitAt=new Date(now()).toISOString();health.exitCode=Number.isSafeInteger(exitCode)&&exitCode>=0?exitCode:null;
        health.exitSignal=typeof signal==='string'&&/^SIG[A-Z0-9]{1,12}$/.test(signal)?signal:null;
        if(!stopped){if(epoch!==generation&&state.feedConnected){attempted=false;void start();}else note('BLOCKED','WORKER_EXITED_NO_AUTO_RETRY');}
        else publish();}});
    }catch{note('BLOCKED','HOST_START_FAILED');}
    finally{pending=false;if(epoch!==generation&&state.feedConnected&&!stopped)void start();}
  }
  return result;
}
