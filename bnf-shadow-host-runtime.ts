import { fetchH1KiteLiveInstrumentMaster } from './h1-kite-live-instrument-master-adapter.js';
import { resolveIndexExpiryClock } from './index-expiry-clock.js';
import { createBnfShadowHost } from './bnf_shadow/host.ts';

let current:ReturnType<typeof createBnfShadowHost>|null=null;
export function readBnfShadowHostStatus(){return current?.status()??{enabled:false,phase:'DISABLED',brokerOrders:0};}
export async function prepareBnfShadowHostRuntime(entries:any[],masterDate:string,apiKey:string,accessToken:string){
  if(process.env.BNF_SHADOW_ENABLED!=='true')return null;
  if(!process.env.BNF_SHADOW_CONFIG_PATH){console.warn('[BNF_SHADOW_HOST] CONFIG_PATH_REQUIRED');return null;}
  try{
    const master=await fetchH1KiteLiveInstrumentMaster({apiKey,accessToken,
      fetchImpl:((url:any,init:any)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})) as typeof fetch});
    if(!master.ready){console.warn('[BNF_SHADOW_HOST] MASTER_UNAVAILABLE');return null;}
    if(current){await current.stop();if(current.status().childRunning){console.warn("[BNF_SHADOW_HOST] PREVIOUS_WORKER_STILL_STOPPING");return null;}}
    current=createBnfShadowHost({enabled:true,env:process.env,entries,masterRows:master.rows,masterDate,
      configPath:process.env.BNF_SHADOW_CONFIG_PATH,python:process.env.BNF_SHADOW_PYTHON||'python',
      resolveClock:resolveIndexExpiryClock,onStatus:(status:any)=>console.info('[BNF_SHADOW_HOST] '+JSON.stringify(status))});
    return current;
  }catch{console.warn('[BNF_SHADOW_HOST] PREPARATION_BLOCKED');return null;}
}
